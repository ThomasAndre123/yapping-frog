export function createProtocolResponse(raw) {
  let event;

  try {
    event = JSON.parse(raw.toString());
  } catch {
    return {
      type: 'error',
      error: {
        code: 'INVALID_JSON',
        message: 'Message must be valid JSON'
      }
    };
  }

  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return {
      type: 'error',
      error: {
        code: 'INVALID_EVENT',
        message: 'Message must be a JSON object'
      }
    };
  }

  if (event.type !== 'echo') {
    return {
      type: 'error',
      requestId: event.requestId,
      error: {
        code: 'UNKNOWN_EVENT',
        message: 'Supported event type: echo'
      }
    };
  }

  return {
    type: 'echo.response',
    requestId: event.requestId,
    data: event.data ?? null,
    receivedAt: new Date().toISOString()
  };
}
