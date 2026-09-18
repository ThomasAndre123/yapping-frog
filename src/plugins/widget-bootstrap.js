import { createHash } from 'node:crypto';

import fp from 'fastify-plugin';

import { isHostnameAllowed } from '../security/allowed-domain.js';

const CACHE_SECONDS = 60;

function cacheKey(siteKey) {
  return `widget-site:${createHash('sha256').update(siteKey).digest('hex')}`;
}

function originHostname(origin) {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

async function widgetBootstrapPlugin(app) {
  const database = app.dependencies.postgres;
  const cache = app.dependencies.redis;
  const inFlightLookups = new Map();

  async function loadSite(siteKey, key, log) {
    if (inFlightLookups.has(key)) return inFlightLookups.get(key);

    const lookup = (async () => {
      const result = await database.query(`
        SELECT
          site.public_id,
          site.name,
          site.allowed_domains,
          tenant.public_id AS tenant_public_id
        FROM tenant_sites site
        JOIN tenants tenant ON tenant.id = site.tenant_id
        WHERE site.widget_key = $1
          AND site.status = 1
          AND tenant.status = 1
          AND (
            tenant.subscription_valid_until IS NULL
            OR tenant.subscription_valid_until > NOW()
          )
      `, [siteKey]);

      if (result.rowCount !== 1) return null;
      const loadedSite = result.rows[0];
      try {
        await cache.setEx?.(key, CACHE_SECONDS, JSON.stringify(loadedSite));
      } catch (error) {
        log.warn({ err: error }, 'Widget site cache write failed');
      }
      return loadedSite;
    })();

    inFlightLookups.set(key, lookup);
    try {
      return await lookup;
    } finally {
      inFlightLookups.delete(key);
    }
  }

  app.get('/api/widget/v1/bootstrap', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        required: ['siteKey'],
        properties: {
          siteKey: { type: 'string', pattern: '^site_pk_[A-Za-z0-9_-]{32,}$' }
        }
      }
    }
  }, async (request, reply) => {
    const hostname = originHostname(request.headers.origin);
    if (!hostname) return reply.code(403).send({ error: 'A valid Origin header is required' });

    const key = cacheKey(request.query.siteKey);
    let site;

    try {
      const cached = await cache.get?.(key);
      if (cached) site = JSON.parse(cached);
    } catch (error) {
      request.log.warn({ err: error }, 'Widget site cache read failed');
    }

    if (!site) {
      site = await loadSite(request.query.siteKey, key, request.log);
      if (!site) {
        return reply.code(404).send({ error: 'Site not found or unavailable' });
      }
    }

    if (!isHostnameAllowed(hostname, site.allowed_domains)) {
      return reply.code(403).send({ error: 'Origin is not allowed for this site' });
    }

    return {
      site: {
        publicId: site.public_id,
        name: site.name
      }
    };
  });
}

export default fp(widgetBootstrapPlugin, {
  name: 'widget-bootstrap',
  dependencies: ['dependencies']
});
