const DEFAULT_CHECK_TIMEOUT_MS = 3_000;

async function checkDependency(dependency, timeoutMs) {
  const startedAt = performance.now();
  let timeout;

  try {
    await Promise.race([
      dependency.check(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Health check timed out')),
          timeoutMs
        );
      })
    ]);

    return {
      status: 'ok',
      message: 'Connection successful',
      latencyMs: Math.round(performance.now() - startedAt)
    };
  } catch {
    return {
      status: 'error',
      message: 'Connection failed',
      latencyMs: Math.round(performance.now() - startedAt)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function healthRoutes(app, options) {
  const timeoutMs = options.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;

  app.get('/health', async (_request, reply) => {
    const [postgres, redis] = await Promise.all([
      checkDependency(app.dependencies.postgres, timeoutMs),
      checkDependency(app.dependencies.redis, timeoutMs)
    ]);
    const checks = { postgres, redis };
    const healthy = Object.values(checks).every(
      (check) => check.status === 'ok'
    );

    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'unavailable',
      message: healthy
        ? 'Service and dependencies are healthy'
        : 'One or more required dependencies are unavailable',
      service: 'yapping-frog',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      checks
    });
  });
}
