import Fastify from 'fastify';

import dependenciesPlugin from './plugins/dependencies.js';
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

  return app;
}
