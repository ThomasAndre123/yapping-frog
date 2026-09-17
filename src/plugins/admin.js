import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fp from 'fastify-plugin';

import { hashPassword, verifyPassword } from '../security/password.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const adminDirectory = path.resolve(currentDirectory, '../../admin');

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function cookieValue(header, name) {
  const cookie = header?.split(';').find((item) => item.trim().startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.trim().slice(name.length + 1)) : null;
}

function sessionCookie(token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

function expiredSessionCookie() {
  return 'admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
}

async function adminPlugin(app, options) {
  const database = app.dependencies.postgres;
  const ttlHours = Number(
    options.sessionTtlHours ?? process.env.ADMIN_SESSION_TTL_HOURS ?? 8
  );
  const maxAgeSeconds = ttlHours * 60 * 60;
  const [html, javascript, stylesheet] = await Promise.all([
    readFile(path.join(adminDirectory, 'index.html'), 'utf8'),
    readFile(path.join(adminDirectory, 'app.js'), 'utf8'),
    readFile(path.join(adminDirectory, 'styles.css'), 'utf8')
  ]);

  async function authenticate(request, reply) {
    const token = cookieValue(request.headers.cookie, 'admin_session');

    if (!token) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const hashedToken = tokenHash(token);
    const result = await database.query(`
      SELECT
        a.id,
        a.public_id,
        a.email,
        a.display_name,
        a.role,
        s.csrf_token
      FROM admin_sessions s
      JOIN platform_administrators a ON a.id = s.administrator_id
      WHERE s.token_hash = $1
        AND s.expires_at > NOW()
        AND a.status = 1
    `, [hashedToken]);

    if (result.rowCount !== 1) {
      reply.header('set-cookie', expiredSessionCookie());
      return reply.code(401).send({ error: 'Session expired' });
    }

    request.administrator = result.rows[0];

    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (request.headers['x-csrf-token'] !== result.rows[0].csrf_token) {
        return reply.code(403).send({ error: 'Invalid CSRF token' });
      }
    }
  }

  function requireRole(...roles) {
    return async function authorize(request, reply) {
      await authenticate(request, reply);
      if (reply.sent) return;

      if (!roles.includes(request.administrator.role)) {
        return reply.code(403).send({ error: 'Insufficient permission' });
      }
    };
  }

  async function audit(request, action, targetType, targetId, tenantId = null) {
    await database.query(`
      INSERT INTO admin_audit_log (
        administrator_id,
        action,
        target_type,
        target_id,
        tenant_id,
        ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      request.administrator.id,
      action,
      targetType,
      targetId,
      tenantId,
      request.ip
    ]);
  }

  app.get('/admin', async (_request, reply) => reply.redirect('/admin/'));
  app.get('/admin/', async (_request, reply) => reply.type('text/html').send(html));
  app.get('/admin/app.js', async (_request, reply) => reply.type('application/javascript').send(javascript));
  app.get('/admin/styles.css', async (_request, reply) => reply.type('text/css').send(stylesheet));

  app.post('/api/admin/v1/session', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', minLength: 3, maxLength: 320 },
          password: { type: 'string', minLength: 1, maxLength: 1024 }
        }
      }
    }
  }, async (request, reply) => {
    const result = await database.query(`
      SELECT id, password_hash
      FROM platform_administrators
      WHERE LOWER(email) = LOWER($1) AND status = 1
    `, [request.body.email.trim()]);
    const administrator = result.rows[0];
    const valid = administrator?.password_hash &&
      await verifyPassword(request.body.password, administrator.password_hash);

    if (!valid) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');

    await database.query(`
      INSERT INTO admin_sessions (
        token_hash,
        administrator_id,
        csrf_token,
        expires_at
      ) VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 hour'))
    `, [tokenHash(token), administrator.id, csrfToken, ttlHours]);
    await database.query(`
      UPDATE platform_administrators SET last_login_at = NOW() WHERE id = $1
    `, [administrator.id]);

    reply.header('set-cookie', sessionCookie(token, maxAgeSeconds));
    return { csrfToken };
  });

  app.get('/api/admin/v1/session', { preHandler: authenticate }, async (request) => ({
    administrator: {
      publicId: request.administrator.public_id,
      email: request.administrator.email,
      displayName: request.administrator.display_name,
      role: request.administrator.role
    },
    csrfToken: request.administrator.csrf_token
  }));

  app.delete('/api/admin/v1/session', { preHandler: authenticate }, async (request, reply) => {
    const token = cookieValue(request.headers.cookie, 'admin_session');
    await database.query('DELETE FROM admin_sessions WHERE token_hash = $1', [tokenHash(token)]);
    reply.header('set-cookie', expiredSessionCookie());
    return reply.code(204).send();
  });

  app.patch('/api/admin/v1/password', {
    preHandler: authenticate,
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', minLength: 1, maxLength: 1024 },
          newPassword: { type: 'string', minLength: 1, maxLength: 1024 }
        }
      }
    }
  }, async (request, reply) => {
    const result = await database.query(`
      SELECT password_hash
      FROM platform_administrators
      WHERE id = $1 AND status = 1
    `, [request.administrator.id]);
    const passwordHash = result.rows[0]?.password_hash;

    if (!passwordHash || !await verifyPassword(request.body.currentPassword, passwordHash)) {
      return reply.code(400).send({ error: 'Current password is incorrect' });
    }

    if (await verifyPassword(request.body.newPassword, passwordHash)) {
      return reply.code(400).send({ error: 'New password must be different' });
    }

    const newPasswordHash = await hashPassword(request.body.newPassword);
    await database.query(`
      UPDATE platform_administrators
      SET password_hash = $1, updated_at = NOW()
      WHERE id = $2
    `, [newPasswordHash, request.administrator.id]);
    await audit(
      request,
      'administrator.password.change',
      'platform_administrator',
      request.administrator.public_id
    );

    return { message: 'Password changed' };
  });

  app.get('/api/admin/v1/tenants', { preHandler: authenticate }, async () => {
    const result = await database.query(`
      SELECT public_id, slug, name, status, created_at, updated_at
      FROM tenants
      ORDER BY created_at DESC
      LIMIT 200
    `);
    return { tenants: result.rows };
  });

  app.post('/api/admin/v1/tenants', {
    preHandler: requireRole('operator', 'super_admin'),
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'name'],
        properties: {
          slug: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,62}$' },
          name: { type: 'string', minLength: 1, maxLength: 200 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const result = await database.query(`
        INSERT INTO tenants (slug, name)
        VALUES (LOWER($1), $2)
        RETURNING id, public_id, slug, name, status, created_at, updated_at
      `, [request.body.slug.trim(), request.body.name.trim()]);
      const tenant = result.rows[0];
      await audit(request, 'tenant.create', 'tenant', tenant.public_id, tenant.id);
      delete tenant.id;
      return reply.code(201).send({ tenant });
    } catch (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'Tenant slug already exists' });
      }
      throw error;
    }
  });

  app.patch('/api/admin/v1/tenants/:publicId/status', {
    preHandler: requireRole('operator', 'super_admin'),
    schema: {
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string', format: 'uuid' } }
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['status'],
        properties: { status: { type: 'integer', enum: [1, 2] } }
      }
    }
  }, async (request, reply) => {
    const result = await database.query(`
      UPDATE tenants
      SET status = $1, updated_at = NOW()
      WHERE public_id = $2
      RETURNING id, public_id, slug, name, status, created_at, updated_at
    `, [request.body.status, request.params.publicId]);

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'Tenant not found' });
    }

    const tenant = result.rows[0];
    await audit(request, 'tenant.status.update', 'tenant', tenant.public_id, tenant.id);
    delete tenant.id;
    return { tenant };
  });

  app.get('/api/admin/v1/administrators', {
    preHandler: requireRole('super_admin')
  }, async () => {
    const result = await database.query(`
      SELECT public_id, email, display_name, role, status, created_at, last_login_at
      FROM platform_administrators
      ORDER BY created_at
    `);
    return { administrators: result.rows };
  });

  app.get('/api/admin/v1/audit-log', {
    preHandler: requireRole('super_admin'),
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          before: { type: 'string', pattern: '^[1-9][0-9]*$' }
        }
      }
    }
  }, async (request) => {
    const result = await database.query(`
      SELECT
        log.id,
        log.action,
        log.target_type,
        log.target_id,
        log.reason,
        log.ip_address,
        log.created_at,
        administrator.public_id AS administrator_public_id,
        administrator.email AS administrator_email,
        administrator.display_name AS administrator_name,
        tenant.public_id AS tenant_public_id,
        tenant.name AS tenant_name
      FROM admin_audit_log log
      LEFT JOIN platform_administrators administrator
        ON administrator.id = log.administrator_id
      LEFT JOIN tenants tenant ON tenant.id = log.tenant_id
      WHERE ($1::BIGINT IS NULL OR log.id < $1::BIGINT)
      ORDER BY log.id DESC
      LIMIT 100
    `, [request.query.before ?? null]);

    const entries = result.rows;
    return {
      entries,
      nextBefore: entries.length === 100 ? entries.at(-1).id : null
    };
  });
}

export default fp(adminPlugin, {
  name: 'admin',
  dependencies: ['dependencies']
});
