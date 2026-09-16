import assert from 'node:assert/strict';
import test from 'node:test';

import { hashPassword, verifyPassword } from '../src/security/password.js';

test('password hashes can be verified without storing the password', async () => {
  const encodedHash = await hashPassword('a sufficiently long password');

  assert.equal(encodedHash.includes('a sufficiently long password'), false);
  assert.equal(await verifyPassword('a sufficiently long password', encodedHash), true);
  assert.equal(await verifyPassword('wrong password', encodedHash), false);
});
