import { createHash, randomUUID } from 'node:crypto';

import fp from 'fastify-plugin';
import { WebSocket, WebSocketServer } from 'ws';

import { createProtocolResponse } from '../websocket/protocol.js';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export function canReceiveTenantRoomEvent(identity, tenantId, visibility, memberIds = []) {
  if (!identity || String(identity.tenant_id) !== String(tenantId)) return false;
  return visibility !== 'private' || memberIds.map(String).includes(String(identity.id));
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
    `, [createHash('sha256').update(token).digest('hex')]);
    return result.rows[0] ?? null;
  }

  async function handleUpgrade(request, socket, head) {
    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    try {
      request.tenantUser = await tenantIdentity(request);
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
    publishRoom({ tenantId, visibility, memberIds = [], event }) {
      for (const socket of wss.clients) {
        const identity = socket.tenantUser;
        if (!canReceiveTenantRoomEvent(identity, tenantId, visibility, memberIds)) continue;
        send(socket, event);
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
