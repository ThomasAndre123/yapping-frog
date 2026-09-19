import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import staticPlugin from '@fastify/static';
import fp from 'fastify-plugin';

import { normalizeAllowedDomains } from '../security/allowed-domain.js';
import { hashPassword, verifyPassword } from '../security/password.js';

const tenantDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/tenant');
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const cookieValue = (header, name) => {
  const cookie = header?.split(';').find((item) => item.trim().startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.trim().slice(name.length + 1)) : null;
};
const roles = ['owner', 'administrator', 'agent'];

async function tenantPlugin(app, options) {
  const database = app.dependencies.postgres;
  const ttlHours = Number(options.sessionTtlHours ?? process.env.TENANT_SESSION_TTL_HOURS ?? 12);

  await app.register(staticPlugin, { root: tenantDirectory, prefix: '/app/', decorateReply: false });
  app.get('/app', async (_request, reply) => reply.redirect('/app/'));

  async function authenticate(request, reply) {
    const token = cookieValue(request.headers.cookie, 'tenant_session');
    if (!token) return reply.code(401).send({ error: 'Authentication required' });
    const result = await database.query(`
      SELECT u.id, u.public_id, u.tenant_id, u.email, u.display_name, u.role,
             t.public_id AS tenant_public_id, t.slug AS tenant_slug, t.name AS tenant_name,
             s.csrf_token
      FROM tenant_sessions s
      JOIN tenant_users u ON u.id = s.tenant_user_id
      JOIN tenants t ON t.id = u.tenant_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.status = 1 AND t.status = 1
    `, [tokenHash(token)]);
    if (result.rowCount !== 1) return reply.code(401).send({ error: 'Session expired' });
    request.tenantUser = result.rows[0];
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        request.headers['x-csrf-token'] !== result.rows[0].csrf_token) {
      return reply.code(403).send({ error: 'Invalid CSRF token' });
    }
  }

  const manage = async (request, reply) => {
    await authenticate(request, reply);
    if (!reply.sent && !['owner', 'administrator'].includes(request.tenantUser.role)) {
      return reply.code(403).send({ error: 'Insufficient permission' });
    }
  };

  async function audit(request, action, targetType, targetId, metadata) {
    await database.query(`INSERT INTO tenant_audit_log
      (tenant_id,tenant_user_id,action,target_type,target_id,metadata,ip_address)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [request.tenantUser.tenant_id,
      request.tenantUser.id, action, targetType, targetId, metadata, request.ip]);
  }

  async function publishRoomEvent(request, room, type, data) {
    let memberIds = [];
    if (room.visibility === 'private') {
      const members = await database.query(
        'SELECT tenant_user_id FROM tenant_chat_room_members WHERE room_id=$1',
        [room.id]
      );
      memberIds = members.rows.map((member) => member.tenant_user_id);
    }
    app.tenantRealtime.publishRoom({
      tenantId: request.tenantUser.tenant_id,
      visibility: room.visibility,
      memberIds,
      event: { type, data }
    });
  }

  app.post('/api/tenant/v1/session', { schema: { body: { type: 'object', additionalProperties: false,
    required: ['tenant', 'email', 'password'], properties: {
      tenant: { type: 'string', minLength: 2, maxLength: 63 },
      email: { type: 'string', format: 'email', maxLength: 320 },
      password: { type: 'string', minLength: 1, maxLength: 1024 }
    } } } }, async (request, reply) => {
    const result = await database.query(`
      SELECT u.id, u.password_hash FROM tenant_users u JOIN tenants t ON t.id = u.tenant_id
      WHERE LOWER(t.slug) = LOWER($1) AND LOWER(u.email) = LOWER($2)
        AND u.status = 1 AND t.status = 1
    `, [request.body.tenant.trim(), request.body.email.trim()]);
    const user = result.rows[0];
    if (!user?.password_hash || !await verifyPassword(request.body.password, user.password_hash)) {
      return reply.code(401).send({ error: 'Invalid tenant, email, or password' });
    }
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    await database.query(`INSERT INTO tenant_sessions (token_hash, tenant_user_id, csrf_token, expires_at)
      VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 hour'))`,
    [tokenHash(token), user.id, csrf, ttlHours]);
    await database.query('UPDATE tenant_users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    reply.header('set-cookie', `tenant_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttlHours * 3600}`);
    return { csrfToken: csrf };
  });

  app.get('/api/tenant/v1/session', { preHandler: authenticate }, async (request) => ({
    csrfToken: request.tenantUser.csrf_token,
    user: { publicId: request.tenantUser.public_id, email: request.tenantUser.email,
      displayName: request.tenantUser.display_name, role: request.tenantUser.role },
    tenant: { publicId: request.tenantUser.tenant_public_id, slug: request.tenantUser.tenant_slug,
      name: request.tenantUser.tenant_name }
  }));

  app.delete('/api/tenant/v1/session', { preHandler: authenticate }, async (request, reply) => {
    await database.query('DELETE FROM tenant_sessions WHERE token_hash = $1',
      [tokenHash(cookieValue(request.headers.cookie, 'tenant_session'))]);
    reply.header('set-cookie', 'tenant_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return reply.code(204).send();
  });

  app.get('/api/tenant/v1/sites', { preHandler: authenticate }, async (request) => ({ sites: (await database.query(`
    SELECT public_id, name, widget_key, allowed_domains, status, created_at, updated_at
    FROM tenant_sites WHERE tenant_id = $1 ORDER BY created_at`, [request.tenantUser.tenant_id])).rows }));
  app.post('/api/tenant/v1/sites', { preHandler: manage, schema: { body: { type: 'object', additionalProperties: false,
    required: ['name', 'allowedDomains'], properties: { name: { type: 'string', minLength: 1, maxLength: 200 },
      allowedDomains: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 253 } } } } } }, async (request, reply) => {
    let domains;
    try { domains = normalizeAllowedDomains(request.body.allowedDomains); } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
    const result = await database.query(`INSERT INTO tenant_sites (tenant_id, name, widget_key, allowed_domains)
      VALUES ($1,$2,$3,$4) RETURNING public_id,name,widget_key,allowed_domains,status,created_at,updated_at`,
    [request.tenantUser.tenant_id, request.body.name.trim(), `site_pk_${randomBytes(24).toString('base64url')}`, domains]);
    await audit(request, 'site.create', 'tenant_site', result.rows[0].public_id, {
      name: result.rows[0].name, allowedDomains: result.rows[0].allowed_domains, status: result.rows[0].status
    });
    return reply.code(201).send({ site: result.rows[0] });
  });
  app.patch('/api/tenant/v1/sites/:id', { preHandler: manage }, async (request, reply) => {
    let domains;
    try { domains = normalizeAllowedDomains(request.body.allowedDomains); } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
    const result = await database.query(`UPDATE tenant_sites SET name=$1,allowed_domains=$2,status=$3,updated_at=NOW()
      WHERE public_id=$4 AND tenant_id=$5 RETURNING public_id,name,widget_key,allowed_domains,status,created_at,updated_at`,
    [request.body.name.trim(), domains, request.body.status, request.params.id, request.tenantUser.tenant_id]);
    if (!result.rowCount) return reply.code(404).send({ error: 'Site not found' });
    await audit(request, 'site.update', 'tenant_site', result.rows[0].public_id, {
      name: result.rows[0].name, allowedDomains: result.rows[0].allowed_domains, status: result.rows[0].status
    });
    return { site: result.rows[0] };
  });

  app.get('/api/tenant/v1/users', { preHandler: authenticate }, async (request) => ({ users: (await database.query(`
    SELECT public_id,email,display_name,role,status,created_at,last_login_at FROM tenant_users
    WHERE tenant_id=$1 ORDER BY display_name`, [request.tenantUser.tenant_id])).rows }));
  app.post('/api/tenant/v1/users', { preHandler: manage }, async (request, reply) => {
    if (!roles.includes(request.body.role) || String(request.body.password).length < 8) return reply.code(400).send({ error: 'Invalid user details' });
    try {
      const result = await database.query(`INSERT INTO tenant_users (tenant_id,email,display_name,role,password_hash)
        VALUES ($1,LOWER($2),$3,$4,$5) RETURNING public_id,email,display_name,role,status,created_at,last_login_at`,
      [request.tenantUser.tenant_id, request.body.email.trim(), request.body.displayName.trim(), request.body.role,
        await hashPassword(request.body.password)]);
      await audit(request, 'user.create', 'tenant_user', result.rows[0].public_id, {
        email: result.rows[0].email, displayName: result.rows[0].display_name,
        role: result.rows[0].role, status: result.rows[0].status
      });
      return reply.code(201).send({ user: result.rows[0] });
    } catch (error) { if (error.code === '23505') return reply.code(409).send({ error: 'Email already exists' }); throw error; }
  });
  app.patch('/api/tenant/v1/users/:id', { preHandler: manage }, async (request, reply) => {
    const passwordHash = request.body.password ? await hashPassword(request.body.password) : null;
    const result = await database.query(`UPDATE tenant_users SET email=LOWER($1),display_name=$2,role=$3,status=$4,
      password_hash=COALESCE($5::TEXT,password_hash),updated_at=NOW() WHERE public_id=$6 AND tenant_id=$7
      RETURNING public_id,email,display_name,role,status,created_at,last_login_at`,
    [request.body.email.trim(), request.body.displayName.trim(), request.body.role, request.body.status,
      passwordHash, request.params.id, request.tenantUser.tenant_id]);
    if (!result.rowCount) return reply.code(404).send({ error: 'User not found' });
    await audit(request, 'user.update', 'tenant_user', result.rows[0].public_id, {
      email: result.rows[0].email, displayName: result.rows[0].display_name,
      role: result.rows[0].role, status: result.rows[0].status,
      passwordChanged: Boolean(request.body.password)
    });
    return { user: result.rows[0] };
  });

  const accessibleRoom = `room.tenant_id=$1 AND (room.visibility='tenant' OR room.created_by=$2 OR EXISTS
    (SELECT 1 FROM tenant_chat_room_members member WHERE member.room_id=room.id AND member.tenant_user_id=$2))`;
  app.get('/api/tenant/v1/rooms', { preHandler: authenticate }, async (request) => ({ rooms: (await database.query(`
    SELECT room.public_id,room.title,room.visibility,room.room_kind,room.pinned,room.created_at,room.updated_at,
      creator.display_name AS creator_name,
      (SELECT content FROM tenant_chat_messages WHERE room_id=room.id ORDER BY id DESC LIMIT 1) AS last_message,
      (SELECT COUNT(*)::INTEGER FROM tenant_chat_messages message
       WHERE message.room_id=room.id AND message.sender_id<>$2 AND message.id>COALESCE(
         (SELECT last_read_message_id FROM tenant_chat_room_reads read_state
          WHERE read_state.room_id=room.id AND read_state.tenant_user_id=$2), 0
       )) AS unread_count
    FROM tenant_chat_rooms room JOIN tenant_users creator ON creator.id=room.created_by
    WHERE ${accessibleRoom} ORDER BY room.pinned DESC,room.updated_at DESC`,
  [request.tenantUser.tenant_id, request.tenantUser.id])).rows }));
  app.post('/api/tenant/v1/rooms', { preHandler: authenticate }, async (request, reply) => {
    const visibility = request.body.visibility === 'private' ? 'private' : 'tenant';
    const roomResult = await database.query(`INSERT INTO tenant_chat_rooms (tenant_id,title,visibility,pinned,created_by)
      VALUES ($1,$2,$3,$4,$5) RETURNING id,public_id,title,visibility,room_kind,pinned,created_at,updated_at`,
    [request.tenantUser.tenant_id, request.body.title.trim(), visibility, Boolean(request.body.pinned), request.tenantUser.id]);
    const room = roomResult.rows[0];
    if (visibility === 'private') {
      await database.query(`INSERT INTO tenant_chat_room_members (room_id,tenant_user_id)
        SELECT $1,id FROM tenant_users WHERE tenant_id=$2 AND (public_id = ANY($3::UUID[]) OR id=$4)
        ON CONFLICT DO NOTHING`, [room.id, request.tenantUser.tenant_id, request.body.memberIds ?? [], request.tenantUser.id]);
    }
    await audit(request, 'room.create', 'tenant_chat_room', room.public_id, {
      title: room.title, visibility: room.visibility, pinned: room.pinned,
      memberIds: visibility === 'private' ? request.body.memberIds ?? [] : []
    });
    await publishRoomEvent(request, room, 'tenant.room.created', {
      roomId: room.public_id
    });
    delete room.id;
    return reply.code(201).send({ room });
  });
  app.patch('/api/tenant/v1/rooms/:id', { preHandler: manage }, async (request, reply) => {
    const result = await database.query(`UPDATE tenant_chat_rooms room SET title=$1,pinned=$2,updated_at=NOW()
      WHERE room.public_id=$3 AND room.tenant_id=$4 RETURNING id,public_id,title,visibility,room_kind,pinned,created_at,updated_at`,
    [request.body.title.trim(), Boolean(request.body.pinned), request.params.id, request.tenantUser.tenant_id]);
    if (!result.rowCount) return reply.code(404).send({ error: 'Room not found' });
    await audit(request, 'room.update', 'tenant_chat_room', result.rows[0].public_id, {
      title: result.rows[0].title, visibility: result.rows[0].visibility, pinned: result.rows[0].pinned
    });
    await publishRoomEvent(request, result.rows[0], 'tenant.room.updated', {
      roomId: result.rows[0].public_id
    });
    delete result.rows[0].id;
    return { room: result.rows[0] };
  });
  app.delete('/api/tenant/v1/rooms/:id', { preHandler: manage }, async (request, reply) => {
    const found = await database.query(`SELECT id,public_id,title,visibility,room_kind
      FROM tenant_chat_rooms WHERE public_id=$1 AND tenant_id=$2`,
    [request.params.id, request.tenantUser.tenant_id]);
    if (!found.rowCount) return reply.code(404).send({ error: 'Room not found' });
    const room = found.rows[0];
    if (room.room_kind !== 'internal') {
      return reply.code(409).send({ error: 'Rooms associated with visitors cannot be deleted' });
    }
    let memberIds = [];
    if (room.visibility === 'private') {
      memberIds = (await database.query(
        'SELECT tenant_user_id FROM tenant_chat_room_members WHERE room_id=$1', [room.id]
      )).rows.map((member) => member.tenant_user_id);
    }
    await database.query('DELETE FROM tenant_chat_rooms WHERE id=$1', [room.id]);
    await audit(request, 'room.delete', 'tenant_chat_room', room.public_id, {
      title: room.title, visibility: room.visibility, roomKind: room.room_kind
    });
    app.tenantRealtime.publishRoom({
      tenantId: request.tenantUser.tenant_id,
      visibility: room.visibility,
      memberIds,
      event: { type: 'tenant.room.deleted', data: { roomId: room.public_id } }
    });
    return reply.code(204).send();
  });

  app.get('/api/tenant/v1/audit-log', { preHandler: manage }, async (request) => ({
    entries: (await database.query(`SELECT log.id,log.action,log.target_type,log.target_id,
      log.metadata,log.ip_address,log.created_at,actor.display_name AS user_name,actor.email AS user_email
      FROM tenant_audit_log log LEFT JOIN tenant_users actor ON actor.id=log.tenant_user_id
      WHERE log.tenant_id=$1 ORDER BY log.id DESC LIMIT 200`, [request.tenantUser.tenant_id])).rows
  }));
  app.get('/api/tenant/v1/rooms/:id/messages', { preHandler: authenticate }, async (request, reply) => {
    const room = await database.query(`SELECT room.id,room.visibility FROM tenant_chat_rooms room WHERE room.public_id=$3 AND ${accessibleRoom}`,
      [request.tenantUser.tenant_id, request.tenantUser.id, request.params.id]);
    if (!room.rowCount) return reply.code(404).send({ error: 'Room not found' });
    return { messages: (await database.query(`SELECT message.public_id,message.content,message.created_at,
      sender.public_id AS sender_public_id,sender.display_name AS sender_name FROM tenant_chat_messages message
      JOIN tenant_users sender ON sender.id=message.sender_id WHERE message.room_id=$1 ORDER BY message.id`, [room.rows[0].id])).rows };
  });
  app.post('/api/tenant/v1/rooms/:id/messages', { preHandler: authenticate }, async (request, reply) => {
    const room = await database.query(`SELECT room.id,room.visibility FROM tenant_chat_rooms room WHERE room.public_id=$3 AND ${accessibleRoom}`,
      [request.tenantUser.tenant_id, request.tenantUser.id, request.params.id]);
    if (!room.rowCount) return reply.code(404).send({ error: 'Room not found' });
    const result = await database.query(`INSERT INTO tenant_chat_messages (room_id,sender_id,content) VALUES ($1,$2,$3)
      RETURNING public_id,content,created_at`, [room.rows[0].id, request.tenantUser.id, request.body.content.trim()]);
    await database.query('UPDATE tenant_chat_rooms SET updated_at=NOW() WHERE id=$1', [room.rows[0].id]);
    const message = { ...result.rows[0], sender_public_id: request.tenantUser.public_id,
      sender_name: request.tenantUser.display_name };
    await publishRoomEvent(request, room.rows[0], 'tenant.message.created', {
      roomId: request.params.id,
      message
    });
    return reply.code(201).send({ message });
  });
  app.post('/api/tenant/v1/rooms/:id/read', { preHandler: authenticate }, async (request, reply) => {
    const room = await database.query(`SELECT room.id FROM tenant_chat_rooms room WHERE room.public_id=$3 AND ${accessibleRoom}`,
      [request.tenantUser.tenant_id, request.tenantUser.id, request.params.id]);
    if (!room.rowCount) return reply.code(404).send({ error: 'Room not found' });
    await database.query(`INSERT INTO tenant_chat_room_reads (room_id,tenant_user_id,last_read_message_id)
      SELECT $1,$2,MAX(id) FROM tenant_chat_messages WHERE room_id=$1
      ON CONFLICT (room_id,tenant_user_id) DO UPDATE
      SET last_read_message_id=EXCLUDED.last_read_message_id,updated_at=NOW()`,
    [room.rows[0].id, request.tenantUser.id]);
    app.tenantRealtime.publishUser({
      tenantId: request.tenantUser.tenant_id,
      userId: request.tenantUser.id,
      event: { type: 'tenant.room.read', data: { roomId: request.params.id } }
    });
    return reply.code(204).send();
  });
}

export default fp(tenantPlugin, { name: 'tenant', dependencies: ['dependencies'] });
