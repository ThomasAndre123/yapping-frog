import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';

const dependencies = {
  postgres: { async check() {} },
  redis: { async check() {} }
};

test('GET / serves the development client', async (t) => {
  const app = buildApp({ logger: false, dependencies });
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/' });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /^text\/html/);
  assert.match(response.body, /<title>Yapping Frog Chat<\/title>/);
});
