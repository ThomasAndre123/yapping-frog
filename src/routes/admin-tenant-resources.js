import { createHash, randomBytes } from 'node:crypto';

import { hashPassword } from '../security/password.js';
import { normalizeAllowedDomains } from '../security/allowed-domain.js';

const uuidParams = {
  type: 'object',
  required: ['publicId'],
  properties: { publicId: { type: 'string', format: 'uuid' } }
};

const nestedUuidParams = {
  type: 'object',
  required: ['publicId', 'resourceId'],
  properties: {
    publicId: { type: 'string', format: 'uuid' },
    resourceId: { type: 'string', format: 'uuid' }
  }
};

function secretHash(secret) {
  return createHash('sha256').update(secret).digest('hex');
}

async function findTenant(database, publicId) {
  const result = await database.query(
    'SELECT id, public_id FROM tenants WHERE public_id = $1',
    [publicId]
  );
  return result.rows[0];
}

export function registerAdminTenantResourceRoutes(app, {
  authenticate,
  requireRole,
  audit
}) {
  const database = app.dependencies.postgres;
  const cache = app.dependencies.redis;

  app.get('/api/admin/v1/tenants/:publicId/resources', {
    preHandler: authenticate,
    schema: { params: uuidParams }
  }, async (request, reply) => {
    const tenant = await findTenant(database, request.params.publicId);
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

    const [sites, users, apiKeys] = await Promise.all([
      database.query(`
        SELECT public_id, name, widget_key, allowed_domains, status, created_at, updated_at
        FROM tenant_sites WHERE tenant_id = $1 ORDER BY created_at
      `, [tenant.id]),
      database.query(`
        SELECT public_id, email, display_name, role, status, created_at, last_login_at
        FROM tenant_users WHERE tenant_id = $1 ORDER BY created_at
      `, [tenant.id]),
      database.query(`
        SELECT public_id, name, key_prefix, scopes, expires_at, created_at,
               last_used_at, revoked_at
        FROM tenant_api_keys WHERE tenant_id = $1 ORDER BY created_at DESC
      `, [tenant.id])
    ]);

    return { sites: sites.rows, users: users.rows, apiKeys: apiKeys.rows };
  });

  app.post('/api/admin/v1/tenants/:publicId/sites', {
    preHandler: requireRole('operator', 'super_admin'),
    schema: {
      params: uuidParams,
      body: {
        type: 'object', additionalProperties: false,
        required: ['name', 'allowedDomains'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          allowedDomains: {
            type: 'array', minItems: 1, maxItems: 100,
            items: { type: 'string', minLength: 1, maxLength: 253 }
          }
        }
      }
    }
  }, async (request, reply) => {
    const tenant = await findTenant(database, request.params.publicId);
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });
    let domains;
    try {
      domains = normalizeAllowedDomains(request.body.allowedDomains);
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
    const widgetKey = `site_pk_${randomBytes(24).toString('base64url')}`;
    const result = await database.query(`
      INSERT INTO tenant_sites (tenant_id, name, widget_key, allowed_domains)
      VALUES ($1, $2, $3, $4)
      RETURNING public_id, name, widget_key, allowed_domains, status, created_at, updated_at
    `, [tenant.id, request.body.name.trim(), widgetKey, domains]);
    const site = result.rows[0];
    await audit(request, 'tenant.site.create', 'tenant_site', site.public_id, {
      tenantPublicId: request.params.publicId,
      name: site.name,
      allowedDomains: site.allowed_domains,
      status: site.status
    });
    return reply.code(201).send({ site });
  });

  app.patch('/api/admin/v1/tenants/:publicId/sites/:resourceId', {
    preHandler: requireRole('operator', 'super_admin'),
    schema: {
      params: nestedUuidParams,
      body: {
        type: 'object', additionalProperties: false,
        required: ['name', 'allowedDomains', 'status'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          allowedDomains: {
            type: 'array', minItems: 1, maxItems: 100,
            items: { type: 'string', minLength: 1, maxLength: 253 }
          },
          status: { type: 'integer', enum: [1, 2] }
        }
      }
    }
  }, async (request, reply) => {
    let domains;
    try {
      domains = normalizeAllowedDomains(request.body.allowedDomains);
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
    const result = await database.query(`
      UPDATE tenant_sites site
      SET name = $1, allowed_domains = $2, status = $3, updated_at = NOW()
      FROM tenants tenant
      WHERE site.public_id = $4 AND tenant.public_id = $5 AND site.tenant_id = tenant.id
      RETURNING site.public_id, site.name, site.widget_key, site.allowed_domains,
                site.status, site.created_at, site.updated_at
    `, [request.body.name.trim(), domains, request.body.status,
      request.params.resourceId, request.params.publicId]);
    if (result.rowCount === 0) return reply.code(404).send({ error: 'Site not found' });
    const site = result.rows[0];
    try {
      await cache.del?.(`widget-site:${secretHash(site.widget_key)}`);
    } catch (error) {
      request.log.warn({ err: error }, 'Widget site cache invalidation failed');
    }
    await audit(request, 'tenant.site.update', 'tenant_site', site.public_id, {
      tenantPublicId: request.params.publicId,
      name: site.name,
      allowedDomains: site.allowed_domains,
      status: site.status
    });
    return { site };
  });

  app.post('/api/admin/v1/tenants/:publicId/users', {
    preHandler: requireRole('operator', 'super_admin'),
    schema: {
      params: uuidParams,
      body: {
        type: 'object', additionalProperties: false,
        required: ['email', 'displayName', 'role', 'password'],
        properties: {
          email: { type: 'string', format: 'email', maxLength: 320 },
          displayName: { type: 'string', minLength: 1, maxLength: 200 },
          role: { type: 'string', enum: ['owner', 'administrator', 'agent'] },
          password: { type: 'string', minLength: 8, maxLength: 1024 }
        }
      }
    }
  }, async (request, reply) => {
    const tenant = await findTenant(database, request.params.publicId);
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });
    try {
      const result = await database.query(`
        INSERT INTO tenant_users (tenant_id, email, display_name, role, password_hash)
        VALUES ($1, LOWER($2), $3, $4, $5)
        RETURNING public_id, email, display_name, role, status, created_at, last_login_at
      `, [tenant.id, request.body.email.trim(), request.body.displayName.trim(),
        request.body.role, await hashPassword(request.body.password)]);
      const user = result.rows[0];
      await audit(request, 'tenant.user.create', 'tenant_user', user.public_id, {
        tenantPublicId: request.params.publicId,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        status: user.status
      });
      return reply.code(201).send({ user });
    } catch (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'A user with this email already exists' });
      }
      throw error;
    }
  });

  app.patch('/api/admin/v1/tenants/:publicId/users/:resourceId', {
    preHandler: requireRole('operator', 'super_admin'),
    schema: {
      params: nestedUuidParams,
      body: {
        type: 'object', additionalProperties: false,
        required: ['email', 'displayName', 'role', 'status'],
        properties: {
          email: { type: 'string', format: 'email', maxLength: 320 },
          displayName: { type: 'string', minLength: 1, maxLength: 200 },
          role: { type: 'string', enum: ['owner', 'administrator', 'agent'] },
          status: { type: 'integer', enum: [1, 2] }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const result = await database.query(`
        UPDATE tenant_users tenant_user
        SET email = LOWER($1), display_name = $2, role = $3, status = $4, updated_at = NOW()
        FROM tenants tenant
        WHERE tenant_user.public_id = $5 AND tenant.public_id = $6
          AND tenant_user.tenant_id = tenant.id
        RETURNING tenant_user.public_id, tenant_user.email, tenant_user.display_name,
                  tenant_user.role, tenant_user.status, tenant_user.created_at,
                  tenant_user.last_login_at
      `, [request.body.email.trim(), request.body.displayName.trim(), request.body.role,
        request.body.status, request.params.resourceId, request.params.publicId]);
      if (result.rowCount === 0) return reply.code(404).send({ error: 'User not found' });
      const user = result.rows[0];
      await audit(request, 'tenant.user.update', 'tenant_user', user.public_id, {
        tenantPublicId: request.params.publicId,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        status: user.status
      });
      return { user };
    } catch (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'A user with this email already exists' });
      }
      throw error;
    }
  });

  app.post('/api/admin/v1/tenants/:publicId/api-keys', {
    preHandler: requireRole('operator', 'super_admin'),
    schema: {
      params: uuidParams,
      body: {
        type: 'object', additionalProperties: false,
        required: ['name', 'scopes', 'expiresAt'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          scopes: { type: 'array', maxItems: 50, items: { type: 'string', pattern: '^[a-z][a-z0-9_.:-]{0,63}$' } },
          expiresAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] }
        }
      }
    }
  }, async (request, reply) => {
    const tenant = await findTenant(database, request.params.publicId);
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });
    const secret = `yf_sk_${randomBytes(32).toString('base64url')}`;
    const prefix = `${secret.slice(0, 13)}…`;
    const result = await database.query(`
      INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, secret_hash, scopes, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING public_id, name, key_prefix, scopes, expires_at, created_at,
                last_used_at, revoked_at
    `, [tenant.id, request.body.name.trim(), prefix, secretHash(secret),
      [...new Set(request.body.scopes)], request.body.expiresAt]);
    const apiKey = result.rows[0];
    await audit(request, 'tenant.api_key.create', 'tenant_api_key', apiKey.public_id, {
      tenantPublicId: request.params.publicId,
      name: apiKey.name,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expires_at
    });
    return reply.code(201).send({ apiKey, secret });
  });

  app.delete('/api/admin/v1/tenants/:publicId/api-keys/:resourceId', {
    preHandler: requireRole('operator', 'super_admin'),
    schema: { params: nestedUuidParams }
  }, async (request, reply) => {
    const result = await database.query(`
      UPDATE tenant_api_keys api_key SET revoked_at = COALESCE(revoked_at, NOW())
      FROM tenants tenant
      WHERE api_key.public_id = $1 AND tenant.public_id = $2
        AND api_key.tenant_id = tenant.id
      RETURNING api_key.public_id
    `, [request.params.resourceId, request.params.publicId]);
    if (result.rowCount === 0) return reply.code(404).send({ error: 'API key not found' });
    await audit(request, 'tenant.api_key.revoke', 'tenant_api_key',
      result.rows[0].public_id, {
        tenantPublicId: request.params.publicId,
        revoked: true
      });
    return reply.code(204).send();
  });
}
