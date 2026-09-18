import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';

test('widget bootstrap validates origin and caches site configuration', async (t) => {
  const values = new Map();
  let databaseQueries = 0;
  const app = buildApp({
    logger: false,
    dependencies: {
      postgres: {
        async check() {},
        async query() {
          databaseQueries += 1;
          return {
            rowCount: 1,
            rows: [{
              public_id: '481a11cf-da76-45bf-bd8b-d0f880d65991',
              name: 'Storefront',
              allowed_domains: ['example.com', '*.example.org'],
              tenant_public_id: 'e7af6985-3265-401c-a271-31ae4a502298'
            }]
          };
        }
      },
      redis: {
        async check() {},
        async get(key) { return values.get(key) ?? null; },
        async setEx(key, _seconds, value) { values.set(key, value); }
      }
    }
  });
  t.after(() => app.close());
  const url = `/api/widget/v1/bootstrap?siteKey=site_pk_${'a'.repeat(32)}`;

  const first = await app.inject({ method: 'GET', url, headers: { origin: 'https://example.com' } });
  const second = await app.inject({ method: 'GET', url, headers: { origin: 'https://chat.example.org' } });
  const rejected = await app.inject({ method: 'GET', url, headers: { origin: 'https://evil.example' } });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(rejected.statusCode, 403);
  assert.equal(databaseQueries, 1);
  assert.deepEqual(first.json(), {
    site: { publicId: '481a11cf-da76-45bf-bd8b-d0f880d65991', name: 'Storefront' }
  });
});
