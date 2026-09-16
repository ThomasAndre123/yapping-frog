import assert from 'node:assert/strict';
import test from 'node:test';

import { createProtocolResponse } from '../src/websocket/protocol.js';

test('echo event returns its data and request ID', () => {
  const response = createProtocolResponse(JSON.stringify({
    type: 'echo',
    requestId: 'request-1',
    data: { message: 'Hello' }
  }));

  assert.equal(response.type, 'echo.response');
  assert.equal(response.requestId, 'request-1');
  assert.deepEqual(response.data, { message: 'Hello' });
  assert.equal(typeof response.receivedAt, 'string');
});

test('invalid JSON returns a protocol error', () => {
  const response = createProtocolResponse('{invalid');

  assert.deepEqual(response, {
    type: 'error',
    error: {
      code: 'INVALID_JSON',
      message: 'Message must be valid JSON'
    }
  });
});

test('unknown event type returns a protocol error', () => {
  const response = createProtocolResponse(JSON.stringify({
    type: 'message.send',
    requestId: 'request-2'
  }));

  assert.equal(response.type, 'error');
  assert.equal(response.requestId, 'request-2');
  assert.equal(response.error.code, 'UNKNOWN_EVENT');
});
