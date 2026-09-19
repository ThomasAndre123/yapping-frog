import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';

const dependencies = {
  postgres: { async check() {}, async query() { return { rowCount: 0, rows: [] }; } },
  redis: { async check() {} }
};

test('tenant workspace is served and tenant APIs require authentication', async (t) => {
  const app = buildApp({ logger: false, dependencies });
  t.after(() => app.close());

  const page = await app.inject({ method: 'GET', url: '/app/' });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Yapping Frog Workspace/);
  assert.match(page.body, /id="root"/);

  const assetPath = page.body.match(/src="(\/app\/assets\/[^\"]+\.js)"/)?.[1];
  assert.ok(assetPath);
  assert.equal((await app.inject({ method: 'GET', url: assetPath })).statusCode, 200);

  const rooms = await app.inject({ method: 'GET', url: '/api/tenant/v1/rooms' });
  assert.equal(rooms.statusCode, 401);
});
