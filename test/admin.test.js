import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/security/password.js';

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
  assert.match(page.body, /Change password/);
  assert.match(page.body, /Administrator audit log/);

  const api = await app.inject({ method: 'GET', url: '/api/admin/v1/tenants' });
  assert.equal(api.statusCode, 401);

  const auditApi = await app.inject({
    method: 'GET',
    url: '/api/admin/v1/audit-log'
  });
  assert.equal(auditApi.statusCode, 401);
});

test('authenticated administrator can change password', async (t) => {
  const storedHash = await hashPassword('current password value');
  const queries = [];
  const authenticatedDependencies = {
    postgres: {
      async check() {},
      async query(sql) {
        queries.push(sql);
        if (sql.includes('FROM admin_sessions s')) {
          return {
            rowCount: 1,
            rows: [{
              id: '1',
              public_id: '8c608917-e797-47fd-af90-a752a2423d37',
              email: 'admin@example.com',
              display_name: 'Administrator',
              role: 'super_admin',
              csrf_token: 'csrf-token'
            }]
          };
        }
        if (sql.includes('SELECT password_hash')) {
          return { rowCount: 1, rows: [{ password_hash: storedHash }] };
        }
        return { rowCount: 1, rows: [] };
      }
    },
    redis: { async check() {} }
  };
  const app = buildApp({
    logger: false,
    dependencies: authenticatedDependencies,
    adminEnabled: true
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/admin/v1/password',
    headers: {
      cookie: 'admin_session=session-token',
      'x-csrf-token': 'csrf-token'
    },
    payload: {
      currentPassword: 'current password value',
      newPassword: 'x'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.json().message, /other sessions were revoked/);
  assert.equal(queries.some((sql) => sql.includes('DELETE FROM admin_sessions')), true);
  assert.equal(queries.some((sql) => sql.includes("'administrator.password.change'")), false);
  assert.equal(queries.some((sql) => sql.includes('INSERT INTO admin_audit_log')), true);

  const auditResponse = await app.inject({
    method: 'GET',
    url: '/api/admin/v1/audit-log',
    headers: { cookie: 'admin_session=session-token' }
  });
  assert.equal(auditResponse.statusCode, 200);
  assert.deepEqual(auditResponse.json(), { entries: [], nextBefore: null });
});
