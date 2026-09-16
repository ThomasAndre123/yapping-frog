import { randomUUID } from 'node:crypto';

import fp from 'fastify-plugin';
import { WebSocket, WebSocketServer } from 'ws';

import { createProtocolResponse } from '../websocket/protocol.js';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

async function websocketPlugin(app, options) {
  const wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(request, socket, head) {
    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (websocket) => {
      wss.emit('connection', websocket, request);
    });
  }

  app.server.on('upgrade', handleUpgrade);

  wss.on('connection', (socket) => {
    const connectionId = randomUUID();
    socket.isAlive = true;

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
