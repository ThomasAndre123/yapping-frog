import Fastify from 'fastify';

import adminPlugin from './plugins/admin.js';
import dependenciesPlugin from './plugins/dependencies.js';
import staticFilesPlugin from './plugins/static-files.js';
import websocketPlugin from './plugins/websocket.js';
import healthRoutes from './routes/health.js';

export function buildApp(options = {}) {
  const app = Fastify({
    logger: options.logger ?? true
  });

  app.register(dependenciesPlugin, {
    databaseUrl: options.databaseUrl,
    redisUrl: options.redisUrl,
    dependencies: options.dependencies
  });
  app.register(healthRoutes, {
    checkTimeoutMs: options.healthCheckTimeoutMs
  });
  app.register(websocketPlugin, {
    heartbeatIntervalMs: options.websocketHeartbeatIntervalMs
  });
  app.register(staticFilesPlugin);

  const adminEnabled = options.adminEnabled ?? process.env.ADMIN_ENABLED === 'true';

  if (adminEnabled) {
    app.register(adminPlugin, {
      sessionTtlHours: options.adminSessionTtlHours
    });
  }

  return app;
}
