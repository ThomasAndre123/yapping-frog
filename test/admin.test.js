import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';

const dependencies = {
  postgres: {
    async check() {},
    async query() {
      return { rowCount: 0, rows: [] };
    }
  },
  redis: { async check() {} }
};

test('admin routes do not exist when the plugin is disabled', async (t) => {
  const app = buildApp({ logger: false, dependencies, adminEnabled: false });
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/admin/' });
  assert.equal(response.statusCode, 404);
});

test('enabled admin plugin serves UI and protects its API', async (t) => {
  const app = buildApp({ logger: false, dependencies, adminEnabled: true });
  t.after(() => app.close());

  const page = await app.inject({ method: 'GET', url: '/admin/' });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Yapping Frog Administration/);

  const api = await app.inject({ method: 'GET', url: '/api/admin/v1/tenants' });
  assert.equal(api.statusCode, 401);
});
