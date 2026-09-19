import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import staticPlugin from '@fastify/static';
import fp from 'fastify-plugin';

import { isHostnameAllowed } from '../security/allowed-domain.js';

const widgetDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../dist/widget'
);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const bearer = (header) => header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
const hostname = (origin) => {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
};

const requestOrigin = (request) =>
  request.headers['x-widget-origin'] ?? request.headers.origin;

async function widgetPlugin(app) {
  const database = app.dependencies.postgres;

  await app.register(staticPlugin, {
    root: widgetDirectory,
    prefix: '/widget/',
    decorateReply: false
  });

  async function findSite(siteKey) {
    const result = await database.query(`
      SELECT site.id,site.public_id,site.name,site.allowed_domains,site.tenant_id
      FROM tenant_sites site
      JOIN tenants tenant ON tenant.id=site.tenant_id
      WHERE site.widget_key=$1 AND site.status=1 AND tenant.status=1
        AND (tenant.subscription_valid_until IS NULL OR tenant.subscription_valid_until>NOW())
    `, [siteKey]);
    return result.rows[0] ?? null;
  }

  async function requireSite(request, reply) {
    const site = await findSite(request.body?.siteKey ?? request.query?.siteKey);
    const requestHostname = hostname(requestOrigin(request));
    if (!site) return reply.code(404).send({ error: 'Site not found or unavailable' });
    if (!requestHostname || !isHostnameAllowed(requestHostname, site.allowed_domains)) {
      return reply.code(403).send({ error: 'Origin is not allowed for this site' });
    }
    request.widgetSite = site;
  }

  async function authenticateVisitor(request, reply) {
    const token = bearer(request.headers.authorization);
    if (!token) return reply.code(401).send({ error: 'Visitor session required' });
    const result = await database.query(`
      SELECT visitor.id,visitor.public_id,visitor.site_id,visitor.display_name,
             site.tenant_id,site.allowed_domains
      FROM widget_visitor_sessions session
      JOIN widget_visitors visitor ON visitor.id=session.visitor_id
      JOIN tenant_sites site ON site.id=visitor.site_id
      WHERE session.token_hash=$1 AND session.expires_at>NOW() AND site.status=1
    `, [hash(token)]);
    const visitor = result.rows[0];
    const requestHostname = hostname(requestOrigin(request));
    if (!visitor) return reply.code(401).send({ error: 'Visitor session expired' });
    if (!requestHostname || !isHostnameAllowed(requestHostname, visitor.allowed_domains)) {
      return reply.code(403).send({ error: 'Origin is not allowed for this site' });
    }
    request.widgetVisitor = visitor;
    request.widgetToken = token;
  }

  app.post('/api/widget/v1/session', {
    preHandler: requireSite,
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['siteKey'],
        properties: {
          siteKey: { type: 'string', pattern: '^site_pk_[A-Za-z0-9_-]{32,}$' },
          visitorToken: { type: 'string', minLength: 32, maxLength: 256 }
        }
      }
    }
  }, async (request, reply) => {
    const existingToken = request.body.visitorToken;
    if (existingToken) {
      const existing = await database.query(`
        SELECT visitor.public_id,visitor.display_name,session.expires_at
        FROM widget_visitor_sessions session
        JOIN widget_visitors visitor ON visitor.id=session.visitor_id
        WHERE session.token_hash=$1 AND visitor.site_id=$2 AND session.expires_at>NOW()
      `, [hash(existingToken), request.widgetSite.id]);
      if (existing.rowCount === 1) {
        await database.query(
          'UPDATE widget_visitors SET last_seen_at=NOW() WHERE public_id=$1',
          [existing.rows[0].public_id]
        );
        return {
          visitorToken: existingToken,
          visitor: existing.rows[0],
          site: { publicId: request.widgetSite.public_id, name: request.widgetSite.name }
        };
      }
    }

    const visitor = (await database.query(`
      INSERT INTO widget_visitors (site_id) VALUES ($1)
      RETURNING id,public_id,display_name
    `, [request.widgetSite.id])).rows[0];
    const token = randomBytes(32).toString('base64url');
    await database.query(`
      INSERT INTO widget_visitor_sessions (token_hash,visitor_id,expires_at)
      VALUES ($1,$2,NOW() + INTERVAL '365 days')
    `, [hash(token), visitor.id]);
    await database.query(`
      INSERT INTO tenant_chat_rooms
        (tenant_id,title,visibility,room_kind,pinned,created_by,visitor_id)
      VALUES ($1,'Website visitor','private','visitor',FALSE,NULL,$2)
    `, [request.widgetSite.tenant_id, visitor.id]);
    delete visitor.id;
    return reply.code(201).send({
      visitorToken: token,
      visitor,
      site: { publicId: request.widgetSite.public_id, name: request.widgetSite.name }
    });
  });

  app.get('/api/widget/v1/messages', {
    preHandler: authenticateVisitor
  }, async (request) => ({
    messages: (await database.query(`
      SELECT message.public_id,message.content,message.created_at,
             CASE WHEN message.visitor_id IS NOT NULL THEN 'visitor' ELSE 'agent' END AS sender_type,
             COALESCE(agent.display_name,visitor.display_name,'Visitor') AS sender_name
      FROM tenant_chat_rooms room
      JOIN tenant_chat_messages message ON message.room_id=room.id
      LEFT JOIN tenant_users agent ON agent.id=message.sender_id
      LEFT JOIN widget_visitors visitor ON visitor.id=message.visitor_id
      WHERE room.visitor_id=$1
      ORDER BY message.id
    `, [request.widgetVisitor.id])).rows
  }));

  app.post('/api/widget/v1/messages', {
    preHandler: authenticateVisitor,
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['content'],
        properties: { content: { type: 'string', minLength: 1, maxLength: 4000 } }
      }
    }
  }, async (request, reply) => {
    const room = (await database.query(`
      SELECT id,public_id FROM tenant_chat_rooms
      WHERE visitor_id=$1 ORDER BY updated_at DESC LIMIT 1
    `, [request.widgetVisitor.id])).rows[0];
    if (!room) return reply.code(404).send({ error: 'Conversation not found' });
    const message = (await database.query(`
      INSERT INTO tenant_chat_messages (room_id,visitor_id,content)
      VALUES ($1,$2,$3) RETURNING public_id,content,created_at
    `, [room.id, request.widgetVisitor.id, request.body.content.trim()])).rows[0];
    await database.query('UPDATE tenant_chat_rooms SET updated_at=NOW() WHERE id=$1', [room.id]);
    app.tenantRealtime.publishRoom({
      tenantId: request.widgetVisitor.tenant_id,
      visibility: 'tenant',
      event: {
        type: 'tenant.message.created',
        data: {
          roomId: room.public_id,
          message: { ...message, sender_public_id: null, sender_name: 'Visitor' }
        }
      }
    });
    return reply.code(201).send({
      message: { ...message, sender_type: 'visitor', sender_name: 'Visitor' }
    });
  });

  app.post('/api/widget/v1/identify', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['siteKey', 'visitorToken', 'externalUserId'],
        properties: {
          siteKey: { type: 'string' },
          visitorToken: { type: 'string', minLength: 32, maxLength: 256 },
          externalUserId: { type: 'string', minLength: 1, maxLength: 255 },
          displayName: { type: 'string', minLength: 1, maxLength: 200 }
        }
      }
    }
  }, async (request, reply) => {
    const secret = bearer(request.headers.authorization);
    if (!secret) return reply.code(401).send({ error: 'Tenant API key required' });
    const access = await database.query(`
      SELECT api_key.id,api_key.tenant_id,api_key.scopes,site.id AS site_id
      FROM tenant_api_keys api_key
      JOIN tenant_sites site ON site.tenant_id=api_key.tenant_id
      WHERE api_key.secret_hash=$1 AND api_key.revoked_at IS NULL
        AND (api_key.expires_at IS NULL OR api_key.expires_at>NOW())
        AND site.widget_key=$2 AND site.status=1
    `, [hash(secret), request.body.siteKey]);
    const credential = access.rows[0];
    if (!credential || !credential.scopes.includes('widget.identify')) {
      return reply.code(403).send({ error: 'API key lacks widget.identify scope' });
    }
    const current = await database.query(`
      SELECT visitor.id FROM widget_visitor_sessions session
      JOIN widget_visitors visitor ON visitor.id=session.visitor_id
      WHERE session.token_hash=$1 AND visitor.site_id=$2 AND session.expires_at>NOW()
    `, [hash(request.body.visitorToken), credential.site_id]);
    if (!current.rowCount) return reply.code(404).send({ error: 'Visitor session not found' });
    const currentId = current.rows[0].id;
    const canonical = await database.query(`
      SELECT id FROM widget_visitors WHERE site_id=$1 AND external_user_id=$2
    `, [credential.site_id, request.body.externalUserId]);
    let visitorId = currentId;
    if (canonical.rowCount && String(canonical.rows[0].id) !== String(currentId)) {
      visitorId = canonical.rows[0].id;
      await database.query(
        'UPDATE tenant_chat_rooms SET visitor_id=$1 WHERE visitor_id=$2',
        [visitorId, currentId]
      );
      await database.query(
        'UPDATE tenant_chat_messages SET visitor_id=$1 WHERE visitor_id=$2',
        [visitorId, currentId]
      );
      await database.query(
        'UPDATE widget_visitor_sessions SET visitor_id=$1 WHERE token_hash=$2',
        [visitorId, hash(request.body.visitorToken)]
      );
      await database.query('DELETE FROM widget_visitors WHERE id=$1', [currentId]);
    } else {
      await database.query(`
        UPDATE widget_visitors SET external_user_id=$1,display_name=COALESCE($2,display_name),
          updated_at=NOW() WHERE id=$3
      `, [request.body.externalUserId, request.body.displayName ?? null, currentId]);
    }
    if (request.body.displayName) {
      await database.query(`
        UPDATE tenant_chat_rooms SET title=$1,updated_at=NOW()
        WHERE visitor_id=$2 AND title='Website visitor'
      `, [request.body.displayName.trim(), visitorId]);
    }
    await database.query(
      'UPDATE tenant_api_keys SET last_used_at=NOW() WHERE id=$1',
      [credential.id]
    );
    return { identified: true };
  });
}

export default fp(widgetPlugin, {
  name: 'widget',
  dependencies: ['dependencies', 'websocket']
});
