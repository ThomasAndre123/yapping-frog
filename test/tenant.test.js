import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/security/password.js';

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

  const auditResponse = await app.inject({ method: 'GET', url: '/api/tenant/v1/audit-log',
    headers: { cookie: 'tenant_session=token' } });
  assert.equal(auditResponse.statusCode, 200);
  const auditRead = queries.find(({ sql }) => sql.includes('FROM tenant_audit_log'));
  assert.match(auditRead.sql, /tenant_users actor/);
});

test('tenant login, profile update, and logout are audited without passwords', async (t) => {
  const storedHash = await hashPassword('old password');
  const queries = [];
  const publicId = '8c608917-e797-47fd-af90-a752a2423d37';
  const app = buildApp({ logger: false, dependencies: {
    postgres: { async check() {}, async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('FROM tenant_users u JOIN tenants')) return { rowCount: 1, rows: [{
        id: '4', public_id: publicId, tenant_id: '7', display_name: 'Old name', password_hash: storedHash
      }] };
      if (sql.includes('FROM tenant_sessions s')) return { rowCount: 1, rows: [{
        id: '4', public_id: publicId, tenant_id: '7', email: 'user@example.com',
        display_name: 'Old name', role: 'agent', csrf_token: 'csrf',
        tenant_public_id: '75d14795-8046-40c7-9810-20755f8f1430', tenant_slug: 'acme', tenant_name: 'Acme'
      }] };
      if (sql.includes('SELECT password_hash FROM tenant_users')) {
        return { rowCount: 1, rows: [{ password_hash: storedHash }] };
      }
      if (sql.includes('UPDATE tenant_users') && sql.includes('display_name=$1')) {
        return { rowCount: 1, rows: [{ public_id: publicId, email: 'user@example.com',
          display_name: 'New name', role: 'agent' }] };
      }
      return { rowCount: 1, rows: [] };
    } }, redis: { async check() {} }
  } });
  t.after(() => app.close());

  const login = await app.inject({ method: 'POST', url: '/api/tenant/v1/session',
    headers: { 'user-agent': 'Tenant Client/1.0' },
    payload: { tenant: 'acme', email: 'user@example.com', password: 'old password' } });
  assert.equal(login.statusCode, 200);
  const cookie = login.headers['set-cookie'].split(';')[0];

  const profile = await app.inject({ method: 'PATCH', url: '/api/tenant/v1/profile',
    headers: { cookie, 'x-csrf-token': 'csrf' },
    payload: { displayName: 'New name', currentPassword: 'old password', newPassword: 'new password' } });
  assert.equal(profile.statusCode, 200);

  const logout = await app.inject({ method: 'DELETE', url: '/api/tenant/v1/session',
    headers: { cookie, 'x-csrf-token': 'csrf' } });
  assert.equal(logout.statusCode, 204);

  const audits = queries.filter(({ sql }) => sql.includes('INSERT INTO tenant_audit_log'));
  assert.deepEqual(audits.map(({ values }) => values[2]), [
    'user.session.login', 'user.profile.update', 'user.session.logout'
  ]);
  assert.equal(audits[0].values[5].userAgent, 'Tenant Client/1.0');
  assert.equal(audits[1].values[5].passwordChanged, true);
  assert.equal(JSON.stringify(audits).includes('old password'), false);
  assert.equal(JSON.stringify(audits).includes('new password'), false);
});
