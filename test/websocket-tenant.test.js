import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canReceiveTenantRoomEvent,
  canReceiveWidgetRoomEvent
} from '../src/plugins/websocket.js';

test('private room events are delivered only to selected tenant users', () => {
  const member = { id: '1', tenant_id: '7' };
  const nonmember = { id: '2', tenant_id: '7' };
  const otherTenant = { id: '1', tenant_id: '8' };

  assert.equal(canReceiveTenantRoomEvent(member, '7', 'private', ['1']), true);
  assert.equal(canReceiveTenantRoomEvent(nonmember, '7', 'private', ['1']), false);
  assert.equal(canReceiveTenantRoomEvent(otherTenant, '7', 'private', ['1']), false);
  assert.equal(canReceiveTenantRoomEvent(nonmember, '7', 'tenant'), true);
});

test('visitor room events are delivered only to the matching widget visitor', () => {
  assert.equal(canReceiveWidgetRoomEvent({ id: 'visitor-1' }, 'visitor-1'), true);
  assert.equal(canReceiveWidgetRoomEvent({ id: 'visitor-2' }, 'visitor-1'), false);
  assert.equal(canReceiveWidgetRoomEvent(null, 'visitor-1'), false);
  assert.equal(canReceiveWidgetRoomEvent({ id: 'visitor-1' }, null), false);
});
