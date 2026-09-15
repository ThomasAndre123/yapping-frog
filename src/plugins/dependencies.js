import fp from 'fastify-plugin';
import pg from 'pg';
import { createClient } from 'redis';

const { Pool } = pg;

function createDependencies({ databaseUrl, redisUrl, logger }) {
  const postgres = new Pool({
    connectionString: databaseUrl ?? process.env.DATABASE_URL,
    connectionTimeoutMillis: 2_000,
    max: 20
  });

  const redis = createClient({
    url: redisUrl ?? process.env.REDIS_URL,
    socket: {
      connectTimeout: 2_000,
      reconnectStrategy: false
    }
  });

  redis.on('error', (error) => {
    logger.warn({ err: error }, 'Redis connection error');
  });

  return {
    postgres: {
      async check() {
        await postgres.query('SELECT 1');
      },
      async close() {
        await postgres.end();
      }
    },
    redis: {
      async check() {
        if (!redis.isOpen) {
          await redis.connect();
        }

        await redis.ping();
      },
      async close() {
        if (redis.isOpen) {
          await redis.quit();
        }
      }
    }
  };
}

async function dependenciesPlugin(app, options) {
  const dependencies = options.dependencies ?? createDependencies({
    databaseUrl: options.databaseUrl,
    redisUrl: options.redisUrl,
    logger: app.log
  });

  app.decorate('dependencies', dependencies);

  app.addHook('onClose', async () => {
    await Promise.allSettled(
      Object.values(dependencies).map((dependency) => dependency.close?.())
    );
  });
}

export default fp(dependenciesPlugin, {
  name: 'dependencies'
});
