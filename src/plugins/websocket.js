import { createHash, randomUUID } from 'node:crypto';

import fp from 'fastify-plugin';
import { WebSocket, WebSocketServer } from 'ws';

import { isHostnameAllowed } from '../security/allowed-domain.js';
import { createProtocolResponse } from '../websocket/protocol.js';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

function hostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

export function canReceiveTenantRoomEvent(identity, tenantId, visibility, memberIds = []) {
  if (!identity || String(identity.tenant_id) !== String(tenantId)) return false;
  return visibility !== 'private' || memberIds.map(String).includes(String(identity.id));
}

export function canReceiveWidgetRoomEvent(identity, visitorId) {
  return Boolean(visitorId && identity && String(identity.id) === String(visitorId));
}

async function websocketPlugin(app, options) {
  const wss = new WebSocketServer({ noServer: true });
  const database = app.dependencies.postgres;

  function tenantSessionToken(header) {
    const cookie = header?.split(';').find((item) => item.trim().startsWith('tenant_session='));
    return cookie ? decodeURIComponent(cookie.trim().slice('tenant_session='.length)) : null;
  }

  async function tenantIdentity(request) {
    const token = tenantSessionToken(request.headers.cookie);
    if (!token) return null;
    const result = await database.query(`
      SELECT user_account.id, user_account.public_id, user_account.tenant_id
      FROM tenant_sessions session
      JOIN tenant_users user_account ON user_account.id=session.tenant_user_id
      JOIN tenants tenant ON tenant.id=user_account.tenant_id
      WHERE session.token_hash=$1 AND session.expires_at>NOW()
        AND user_account.status=1 AND tenant.status=1
    `, [tokenHash(token)]);
    return result.rows[0] ?? null;
  }

  async function widgetIdentity(request, url) {
    const token = url.searchParams.get('visitorToken');
    if (!token) return null;
    const result = await database.query(`
      SELECT visitor.id,visitor.public_id,site.tenant_id,site.allowed_domains,site.widget_key
      FROM widget_visitor_sessions session
      JOIN widget_visitors visitor ON visitor.id=session.visitor_id
      JOIN tenant_sites site ON site.id=visitor.site_id
      JOIN tenants tenant ON tenant.id=site.tenant_id
      WHERE session.token_hash=$1 AND session.expires_at>NOW()
        AND site.status=1 AND tenant.status=1
    `, [tokenHash(token)]);
    const visitor = result.rows[0];
    if (!visitor) throw new Error('Invalid widget visitor session');

    const parentOrigin = url.searchParams.get('origin');
    const parentHostname = hostname(parentOrigin);
    const directPreview = !parentOrigin &&
      visitor.widget_key === process.env.DEFAULT_WIDGET_SITE_KEY &&
      hostname(request.headers.origin) === hostname(`http://${request.headers.host}`);
    if (!directPreview &&
        (!parentHostname || !isHostnameAllowed(parentHostname, visitor.allowed_domains))) {
      throw new Error('Widget WebSocket origin is not allowed');
    }
    return visitor;
  }

  async function handleUpgrade(request, socket, head) {
    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    try {
      request.tenantUser = await tenantIdentity(request);
      request.widgetVisitor = await widgetIdentity(request, url);
      wss.handleUpgrade(request, socket, head, (websocket) => {
        wss.emit('connection', websocket, request);
      });
    } catch (error) {
      app.log.warn({ err: error }, 'WebSocket authentication failed');
      socket.destroy();
    }
  }

  app.server.on('upgrade', handleUpgrade);

  wss.on('connection', (socket, request) => {
    const connectionId = randomUUID();
    socket.isAlive = true;
    socket.tenantUser = request.tenantUser;
    socket.widgetVisitor = request.widgetVisitor;

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (raw) => {
      const response = createProtocolResponse(raw);

      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(response));
      }
    });

    socket.send(JSON.stringify({
      type: 'connection.ready',
      data: {
        connectionId
      }
    }));
  });

  function send(socket, event) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }

  app.decorate('tenantRealtime', {
    publishRoom({ tenantId, visibility, memberIds = [], visitorId, event }) {
      for (const socket of wss.clients) {
        const identity = socket.tenantUser;
        const widgetVisitor = socket.widgetVisitor;
        if (canReceiveTenantRoomEvent(identity, tenantId, visibility, memberIds) ||
            canReceiveWidgetRoomEvent(widgetVisitor, visitorId)) {
          send(socket, event);
        }
      }
    },
    publishUser({ tenantId, userId, event }) {
      for (const socket of wss.clients) {
        const identity = socket.tenantUser;
        if (identity && String(identity.tenant_id) === String(tenantId) &&
            String(identity.id) === String(userId)) send(socket, event);
      }
    }
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }

      socket.isAlive = false;
      socket.ping();
    }
  }, options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);

  heartbeat.unref();

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    app.server.off('upgrade', handleUpgrade);

    for (const socket of wss.clients) {
      socket.terminate();
    }

    await new Promise((resolve) => wss.close(resolve));
  });
}

export default fp(websocketPlugin, {
  name: 'websocket'
});
