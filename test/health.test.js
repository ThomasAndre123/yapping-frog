import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';

function createDependencies({ postgresError, redisError } = {}) {
  return {
    postgres: {
      async check() {
        if (postgresError) throw postgresError;
      }
    },
    redis: {
      async check() {
        if (redisError) throw redisError;
      }
    }
  };
}

test('GET /health reports healthy dependencies', async (t) => {
  const app = buildApp({
    logger: false,
    dependencies: createDependencies()
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/health' });
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.message, 'Service and dependencies are healthy');
  assert.equal(body.service, 'yapping-frog');
  assert.equal(typeof body.timestamp, 'string');
  assert.equal(typeof body.uptimeSeconds, 'number');
  assert.equal(body.checks.postgres.status, 'ok');
  assert.equal(body.checks.redis.status, 'ok');
  assert.equal(typeof body.checks.postgres.latencyMs, 'number');
  assert.equal(typeof body.checks.redis.latencyMs, 'number');
});

test('GET /health returns 503 when a dependency is unavailable', async (t) => {
  const app = buildApp({
    logger: false,
    dependencies: createDependencies({
      redisError: new Error('connection refused')
    })
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/health' });
  const body = response.json();

  assert.equal(response.statusCode, 503);
  assert.equal(body.status, 'unavailable');
  assert.equal(
    body.message,
    'One or more required dependencies are unavailable'
  );
  assert.equal(body.checks.postgres.status, 'ok');
  assert.equal(body.checks.redis.status, 'error');
  assert.equal(body.checks.redis.message, 'Connection failed');
  assert.equal(JSON.stringify(body).includes('connection refused'), false);
});
