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
  assert.match(page.body, /id="root"/);
  assert.match(page.body, /type="module"/);

  const assetPath = page.body.match(/src="(\/admin\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(assetPath, 'admin page references its compiled JavaScript');
  const asset = await app.inject({ method: 'GET', url: assetPath });
  assert.equal(asset.statusCode, 200);
  assert.match(asset.headers['content-type'], /javascript/);

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
  assert.equal(response.json().message, 'Password changed');
  assert.equal(queries.some((sql) => sql.includes('DELETE FROM admin_sessions')), false);
  assert.equal(queries.some((sql) => sql.includes('UPDATE platform_administrators')), true);
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

test('super administrator can create and edit administrator accounts', async (t) => {
  const administratorPublicId = '594a5330-3e44-45c1-a3dc-8b0f1dc6f39b';
  const queries = [];
  const app = buildApp({
    logger: false,
    adminEnabled: true,
    dependencies: {
      postgres: {
        async check() {},
        async query(sql, values) {
          queries.push({ sql, values });
          if (sql.includes('FROM admin_sessions s')) {
            return { rowCount: 1, rows: [{
              id: '1', public_id: '8c608917-e797-47fd-af90-a752a2423d37',
              email: 'owner@example.com', display_name: 'Owner', role: 'super_admin',
              csrf_token: 'csrf-token'
            }] };
          }
          if (sql.includes('INSERT INTO platform_administrators')) {
            return { rowCount: 1, rows: [{
              public_id: administratorPublicId, email: 'agent@example.com',
              display_name: 'Agent', role: 'support', status: 1,
              created_at: '2026-09-18T00:00:00.000Z', last_login_at: null
            }] };
          }
          if (sql.includes('UPDATE platform_administrators')) {
            return { rowCount: 1, rows: [{
              public_id: administratorPublicId, email: 'operator@example.com',
              display_name: 'Operator', role: 'operator', status: 2,
              created_at: '2026-09-18T00:00:00.000Z', last_login_at: null
            }] };
          }
          return { rowCount: 1, rows: [] };
        }
      },
      redis: { async check() {} }
    }
  });
  t.after(() => app.close());
  const headers = {
    cookie: 'admin_session=session-token',
    'x-csrf-token': 'csrf-token'
  };

  const created = await app.inject({
    method: 'POST', url: '/api/admin/v1/administrators', headers,
    payload: {
      email: 'agent@example.com', displayName: 'Agent', role: 'support',
      password: 'abc'
    }
  });
  const updated = await app.inject({
    method: 'PATCH', url: `/api/admin/v1/administrators/${administratorPublicId}`, headers,
    payload: {
      email: 'operator@example.com', displayName: 'Operator', role: 'operator', status: 2
    }
  });

  assert.equal(created.statusCode, 201);
  assert.equal(created.json().administrator.role, 'support');
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().administrator.status, 2);
  const inserted = queries.find(({ sql }) => sql.includes('INSERT INTO platform_administrators'));
  assert.equal(inserted.values[0], 'agent@example.com');
  assert.match(inserted.values[3], /^scrypt\$/);
  assert.deepEqual(queries
    .filter(({ sql }) => sql.includes('INSERT INTO admin_audit_log'))
    .map(({ values }) => values[1]), ['administrator.create', 'administrator.update']);
});

test('super administrator cannot disable their own account', async (t) => {
  const selfPublicId = '8c608917-e797-47fd-af90-a752a2423d37';
  const app = buildApp({
    logger: false,
    adminEnabled: true,
    dependencies: {
      postgres: {
        async check() {},
        async query(sql) {
          if (sql.includes('FROM admin_sessions s')) {
            return { rowCount: 1, rows: [{
              id: '1', public_id: selfPublicId, email: 'owner@example.com',
              display_name: 'Owner', role: 'super_admin', csrf_token: 'csrf-token'
            }] };
          }
          return { rowCount: 0, rows: [] };
        }
      },
      redis: { async check() {} }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH', url: `/api/admin/v1/administrators/${selfPublicId}`,
    headers: { cookie: 'admin_session=session-token', 'x-csrf-token': 'csrf-token' },
    payload: {
      email: 'owner@example.com', displayName: 'Owner', role: 'super_admin', status: 2
    }
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /cannot disable/);
});

test('operator tenant edits and status changes are audited', async (t) => {
  const tenantPublicId = '75d14795-8046-40c7-9810-20755f8f1430';
  const queries = [];
  const tenant = {
    id: '7',
    public_id: tenantPublicId,
    slug: 'acme',
    name: 'Acme Incorporated',
    status: 2,
    subscription_type: 'pro',
    subscription_valid_until: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-09-18T00:00:00.000Z',
    previous_status: 1
  };
  const app = buildApp({
    logger: false,
    adminEnabled: true,
    dependencies: {
      postgres: {
        async check() {},
        async query(sql, values) {
          queries.push({ sql, values });
          if (sql.includes('FROM admin_sessions s')) {
            return {
              rowCount: 1,
              rows: [{
                id: '1',
                public_id: '8c608917-e797-47fd-af90-a752a2423d37',
                email: 'operator@example.com',
                display_name: 'Operator',
                role: 'operator',
                csrf_token: 'csrf-token'
              }]
            };
          }
          if (sql.includes('UPDATE tenants') && sql.includes('subscription_type')) {
            return { rowCount: 1, rows: [{ ...tenant }] };
          }
          return { rowCount: 1, rows: [] };
        }
      },
      redis: { async check() {} }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/admin/v1/tenants/${tenantPublicId}`,
    headers: {
      cookie: 'admin_session=session-token',
      'x-csrf-token': 'csrf-token'
    },
    payload: {
      slug: 'acme',
      name: 'Acme Incorporated',
      status: 2,
      subscriptionType: 'pro',
      subscriptionValidUntil: null
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().tenant.subscription_type, 'pro');
  assert.equal(response.json().tenant.subscription_valid_until, null);
  const auditActions = queries
    .filter(({ sql }) => sql.includes('INSERT INTO admin_audit_log'))
    .map(({ values }) => values[1]);
  assert.deepEqual(auditActions, ['tenant.update', 'tenant.status.update']);
  const update = queries.find(({ sql }) =>
    sql.includes('UPDATE tenants') && sql.includes('subscription_type'));
  assert.deepEqual(update.values, [
    'acme',
    'Acme Incorporated',
    2,
    'pro',
    null,
    tenantPublicId
  ]);
});

test('support can view tenant resources but cannot modify them', async (t) => {
  const tenantPublicId = '75d14795-8046-40c7-9810-20755f8f1430';
  const app = buildApp({
    logger: false,
    adminEnabled: true,
    dependencies: {
      postgres: {
        async check() {},
        async query(sql) {
          if (sql.includes('FROM admin_sessions s')) {
            return { rowCount: 1, rows: [{
              id: '1', public_id: '8c608917-e797-47fd-af90-a752a2423d37',
              email: 'support@example.com', display_name: 'Support', role: 'support',
              csrf_token: 'csrf-token'
            }] };
          }
          if (sql.includes('SELECT id, public_id FROM tenants')) {
            return { rowCount: 1, rows: [{ id: '7', public_id: tenantPublicId }] };
          }
          return { rowCount: 0, rows: [] };
        }
      },
      redis: { async check() {} }
    }
  });
  t.after(() => app.close());
  const headers = { cookie: 'admin_session=session-token' };

  const view = await app.inject({
    method: 'GET', url: `/api/admin/v1/tenants/${tenantPublicId}/resources`, headers
  });
  const modify = await app.inject({
    method: 'POST',
    url: `/api/admin/v1/tenants/${tenantPublicId}/sites`,
    headers: { ...headers, 'x-csrf-token': 'csrf-token' },
    payload: { name: 'Store', allowedDomains: ['example.com'] }
  });

  assert.equal(view.statusCode, 200);
  assert.deepEqual(view.json(), { sites: [], users: [], apiKeys: [] });
  assert.equal(modify.statusCode, 403);
});
