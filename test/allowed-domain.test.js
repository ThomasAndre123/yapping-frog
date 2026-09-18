import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isHostnameAllowed,
  normalizeAllowedDomains
} from '../src/security/allowed-domain.js';

test('allowed domains support exact hosts and leading subdomain wildcards', () => {
  const domains = normalizeAllowedDomains([
    'Example.com',
    '*.Support.Example.com',
    'example.com'
  ]);

  assert.deepEqual(domains, ['example.com', '*.support.example.com']);
  assert.equal(isHostnameAllowed('example.com', domains), true);
  assert.equal(isHostnameAllowed('www.example.com', domains), false);
  assert.equal(isHostnameAllowed('chat.support.example.com', domains), true);
  assert.equal(isHostnameAllowed('support.example.com', domains), false);
  assert.equal(isHostnameAllowed('notexample.com', domains), false);
});

test('allowed domains reject broad or embedded wildcard patterns', () => {
  assert.throws(() => normalizeAllowedDomains(['*']), /Invalid allowed domain/);
  assert.throws(() => normalizeAllowedDomains(['shop.*.com']), /Invalid allowed domain/);
});
