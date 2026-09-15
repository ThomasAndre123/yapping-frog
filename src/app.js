import Fastify from 'fastify';

import healthRoutes from './routes/health.js';

export function buildApp(options = {}) {
  const app = Fastify({
    logger: options.logger ?? true
  });

  app.register(healthRoutes);

  return app;
}
