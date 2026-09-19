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

test('tenant owner can rename a room and the change is audited safely', async (t) => {
  const queries = [];
  const roomId = '594a5330-3e44-45c1-a3dc-8b0f1dc6f39b';
  const app = buildApp({ logger: false, dependencies: {
    postgres: { async check() {}, async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('FROM tenant_sessions s')) return { rowCount: 1, rows: [{
        id: '4', public_id: '8c608917-e797-47fd-af90-a752a2423d37', tenant_id: '7',
        email: 'owner@example.com', display_name: 'Owner', role: 'owner', csrf_token: 'csrf',
        tenant_public_id: '75d14795-8046-40c7-9810-20755f8f1430', tenant_slug: 'acme', tenant_name: 'Acme'
      }] };
      if (sql.includes('UPDATE tenant_chat_rooms room')) return { rowCount: 1, rows: [{
        public_id: roomId, title: 'Renamed room', visibility: 'private', pinned: true,
        created_at: '2026-09-19T00:00:00.000Z', updated_at: '2026-09-19T01:00:00.000Z'
      }] };
      return { rowCount: 1, rows: [] };
    } }, redis: { async check() {} }
  } });
  t.after(() => app.close());

  const response = await app.inject({ method: 'PATCH', url: `/api/tenant/v1/rooms/${roomId}`,
    headers: { cookie: 'tenant_session=token', 'x-csrf-token': 'csrf' },
    payload: { title: 'Renamed room', pinned: true } });

  assert.equal(response.statusCode, 200);
  const audit = queries.find(({ sql }) => sql.includes('INSERT INTO tenant_audit_log'));
  assert.equal(audit.values[2], 'room.update');
  assert.deepEqual(audit.values[5], {
    title: 'Renamed room', visibility: 'private', pinned: true
  });
});
