# Embeddable SaaS Chat System

A scalable real-time chat platform designed to be embedded into customer websites as a SaaS product.

## Technology Stack

- **Node.js**
- **Fastify**
- **PostgreSQL**
- **Redis**
- **ws** for WebSocket connections
- Object storage such as S3, DigitalOcean Spaces, or Cloudflare R2 for attachments

The system is designed around a simple principle:

```text
PostgreSQL = durable source of truth
Redis      = temporary realtime coordination
WebSocket  = realtime delivery
HTTP API   = durable state and recovery
```

---

# 1. High-Level Architecture

```text
Customer Website
      │
      │ embed widget.js
      ▼
┌──────────────────────────────┐
│ Chat API / Realtime Server   │
│                              │
│ Node.js                      │
│ Fastify                      │
│ ws                           │
└─────────────┬────────────────┘
              │
      ┌───────┴─────────┐
      │                 │
      ▼                 ▼
 PostgreSQL           Redis
      │                 │
      │                 ├── presence
      │                 ├── socket routing
      │                 ├── typing indicators
      │                 ├── Pub/Sub
      │                 └── rate limiting
      │
      ├── tenants
      ├── visitors
      ├── agents
      ├── conversations
      ├── messages
      ├── read receipts
      └── attachment metadata
```

Attachments should not be stored directly inside PostgreSQL.

Use object storage:

```text
Browser
   │
   │ request upload URL
   ▼
API
   │
   │ signed upload URL
   ▼
Browser ──────────────► S3 / Spaces / R2
```

---

# 2. Why This Stack?

## Node.js

Chat systems are primarily I/O-bound.

Most operations look like:

```text
receive websocket message
        ↓
validate
        ↓
insert into PostgreSQL
        ↓
publish event to Redis
        ↓
send WebSocket event
```

Node.js handles this type of workload efficiently because most of the work consists of network and database I/O rather than CPU-heavy processing.

Horizontal scaling should be preferred over relying on one very large process.

---

## Fastify

Fastify is used as the HTTP/API framework.

Advantages:

- low HTTP overhead
- built-in schema-oriented validation
- good TypeScript support
- structured plugin architecture
- good JSON serialization performance
- suitable for public APIs

Example:

```js
fastify.post('/messages', {
    schema: {
        body: {
            type: 'object',
            required: [
                'conversationId',
                'clientMessageId',
                'content'
            ],
            properties: {
                conversationId: {
                    type: 'integer'
                },
                clientMessageId: {
                    type: 'string',
                    maxLength: 64
                },
                content: {
                    type: 'string',
                    maxLength: 10000
                }
            }
        }
    }
}, async (request, reply) => {
    // ...
});
```

Fastify is not mandatory for the architecture, but it is a good choice for a new Node.js service.

---

# 3. PostgreSQL

PostgreSQL is the primary durable datastore.

It stores:

- tenants
- websites
- members / visitors
- operators / agents
- conversations
- conversation participants
- messages
- read states
- attachment metadata
- audit data

Redis should never be the authoritative message store.

If Redis is completely lost, all durable chat history must still exist in PostgreSQL.

---

# 4. Multi-Tenant Design

Use one shared PostgreSQL cluster initially.

Do not create one database per customer unless there is a strong regulatory or isolation requirement.

Most tenant-owned tables should contain:

```text
tenant_id
```

Example:

```sql
CREATE TABLE tenants (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    public_id UUID NOT NULL UNIQUE,

    name TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Customer websites:

```sql
CREATE TABLE tenant_sites (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    tenant_id BIGINT NOT NULL REFERENCES tenants(id),

    public_id UUID NOT NULL UNIQUE,

    domain TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX tenant_sites_tenant_idx
ON tenant_sites (tenant_id);
```

The public site ID can safely be exposed by the embed script.

Example:

```html
<script
    src="https://cdn.example.com/widget.js"
    data-site-id="f921e73e-....">
</script>
```

The public site ID identifies the website.

It must not provide administrative authorization.

---

# 5. Visitors

Anonymous visitors should receive a persistent visitor ID.

Example:

```sql
CREATE TABLE visitors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    tenant_id BIGINT NOT NULL REFERENCES tenants(id),

    public_id UUID NOT NULL UNIQUE,

    external_user_id TEXT,

    name TEXT,

    email TEXT,

    metadata JSONB,

    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX visitors_tenant_idx
ON visitors (tenant_id);

CREATE INDEX visitors_external_user_idx
ON visitors (
    tenant_id,
    external_user_id
);
```

`external_user_id` allows the SaaS customer to identify their logged-in user.

Example:

```json
{
    "externalUserId": "member-192881"
}
```

Anonymous visitors can simply use the generated public visitor ID.

---

# 6. Agents

```sql
CREATE TABLE agents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    tenant_id BIGINT NOT NULL REFERENCES tenants(id),

    public_id UUID NOT NULL UNIQUE,

    name TEXT NOT NULL,

    email TEXT,

    status SMALLINT NOT NULL DEFAULT 1,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agents_tenant_idx
ON agents (tenant_id);
```

Agent online/offline state should normally live in Redis rather than PostgreSQL.

---

# 7. Conversations

```sql
CREATE TABLE conversations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    tenant_id BIGINT NOT NULL REFERENCES tenants(id),

    public_id UUID NOT NULL UNIQUE,

    visitor_id BIGINT NOT NULL REFERENCES visitors(id),

    assigned_agent_id BIGINT REFERENCES agents(id),

    status SMALLINT NOT NULL DEFAULT 1,

    last_message_id BIGINT,

    last_message_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    closed_at TIMESTAMPTZ
);

CREATE INDEX conversations_tenant_idx
ON conversations (
    tenant_id,
    id DESC
);

CREATE INDEX conversations_agent_idx
ON conversations (
    tenant_id,
    assigned_agent_id,
    status,
    last_message_at DESC
);

CREATE INDEX conversations_visitor_idx
ON conversations (
    tenant_id,
    visitor_id,
    id DESC
);
```

Possible status values:

```text
1 = open
2 = waiting
3 = closed
```

---

# 8. Messages

Messages should be immutable whenever possible.

```sql
CREATE TABLE messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    tenant_id BIGINT NOT NULL REFERENCES tenants(id),

    conversation_id BIGINT NOT NULL REFERENCES conversations(id),

    client_message_id TEXT,

    sender_type SMALLINT NOT NULL,

    sender_id BIGINT,

    message_type SMALLINT NOT NULL DEFAULT 1,

    content TEXT,

    metadata JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Example sender types:

```text
1 = visitor
2 = agent
3 = system
4 = bot
```

Example message types:

```text
1 = text
2 = image
3 = file
4 = event
5 = system
```

Important indexes:

```sql
CREATE INDEX messages_conversation_idx
ON messages (
    conversation_id,
    id DESC
);

CREATE INDEX messages_tenant_created_idx
ON messages (
    tenant_id,
    created_at DESC
);
```

Idempotency:

```sql
CREATE UNIQUE INDEX messages_client_id_unique
ON messages (
    tenant_id,
    client_message_id
)
WHERE client_message_id IS NOT NULL;
```

This allows clients to retry messages safely.

---

# 9. Message Pagination

Do not use:

```sql
OFFSET 100000
```

for message pagination.

Use cursor pagination.

Example:

```sql
SELECT
    id,
    sender_type,
    sender_id,
    message_type,
    content,
    metadata,
    created_at
FROM messages
WHERE conversation_id = $1
AND id < $2
ORDER BY id DESC
LIMIT 50;
```

Initial page:

```sql
SELECT *
FROM messages
WHERE conversation_id = $1
ORDER BY id DESC
LIMIT 50;
```

The final message ID becomes the next cursor.

---

# 10. Message Send Protocol

The browser should generate a unique `clientMessageId`.

Example:

```json
{
    "type": "message.send",
    "requestId": "req_123",
    "data": {
        "conversationId": "conversation-public-id",
        "clientMessageId": "01K7TQX7V7Y0...",
        "content": "Hello"
    }
}
```

Flow:

```text
Browser
   │
   │ message.send
   ▼
WebSocket server
   │
   ├── authenticate connection
   ├── validate tenant
   ├── validate conversation
   ├── validate payload
   │
   ▼
PostgreSQL
   │
   │ INSERT
   ▼
COMMIT
   │
   ├─────────────► ACK sender
   │
   ▼
Redis Pub/Sub
   │
   ▼
Other server instances
   │
   ▼
WebSocket recipients
```

The database commit happens before broadcasting the message.

That guarantees every delivered message is recoverable.

---

# 11. Idempotency

WebSocket connections fail.

Mobile devices disconnect.

Browsers retry.

Therefore a client must be able to safely resend:

```json
{
    "clientMessageId": "abc123"
}
```

Example insert:

```sql
INSERT INTO messages (
    tenant_id,
    conversation_id,
    client_message_id,
    sender_type,
    sender_id,
    content
)
VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6
)
ON CONFLICT (
    tenant_id,
    client_message_id
)
WHERE client_message_id IS NOT NULL
DO NOTHING
RETURNING *;
```

If the insert already exists, fetch the existing message and return it to the client.

This provides effectively idempotent message submission.

---

# 12. WebSocket Protocol

Use the `ws` package rather than tying the protocol to Socket.IO.

Install:

```bash
npm install ws
```

Example Fastify integration:

```js
import Fastify from 'fastify';
import { WebSocketServer } from 'ws';

const fastify = Fastify();

await fastify.listen({
    host: '0.0.0.0',
    port: 3000
});

const wss = new WebSocketServer({
    server: fastify.server
});

wss.on('connection', (socket, request) => {

    socket.on('message', async buffer => {

        let message;

        try {
            message = JSON.parse(buffer.toString());
        } catch {
            socket.close(1003, 'Invalid JSON');
            return;
        }

        // handle protocol message

    });

});
```

---

# 13. Recommended WebSocket Event Format

Use a consistent envelope.

Client request:

```json
{
    "type": "message.send",
    "requestId": "req_123",
    "data": {
        "conversationId": "abc",
        "clientMessageId": "xyz",
        "content": "Hello"
    }
}
```

Server response:

```json
{
    "type": "message.ack",
    "requestId": "req_123",
    "data": {
        "messageId": 928173,
        "clientMessageId": "xyz",
        "createdAt": "2026-09-14T10:00:00.000Z"
    }
}
```

Broadcast:

```json
{
    "type": "message.created",
    "data": {
        "id": 928173,
        "conversationId": "abc",
        "senderType": "visitor",
        "content": "Hello",
        "createdAt": "2026-09-14T10:00:00.000Z"
    }
}
```

Other events:

```text
conversation.created

conversation.assigned

conversation.closed

message.send

message.ack

message.created

message.read

typing.start

typing.stop

presence.update
```

---

# 14. HTTP API

WebSocket should not be the only interface.

Use HTTP for durable state.

Example:

```text
POST /v1/widget/session

GET  /v1/conversations

POST /v1/conversations

GET  /v1/conversations/:id

GET  /v1/conversations/:id/messages

POST /v1/conversations/:id/messages

POST /v1/conversations/:id/read

POST /v1/uploads
```

The WebSocket connection should primarily be used for realtime events.

---

# 15. Reconnection

Never assume a WebSocket connection is reliable.

Example:

```text
connected

message 100
message 101
message 102

network disconnects

message 103
message 104
message 105

client reconnects
```

The client remembers:

```text
lastMessageId = 102
```

Then:

```http
GET /v1/conversations/abc/messages?after=102
```

The server returns:

```text
103
104
105
```

The WebSocket connection then resumes live delivery.

This means WebSocket events do not need perfect delivery guarantees.

PostgreSQL provides the recovery mechanism.

---

# 16. Redis

Redis stores transient state.

Do not store permanent messages only in Redis.

Typical uses:

```text
presence

typing indicators

socket routing

Pub/Sub

rate limiting

temporary sessions

distributed locks

short-lived cache
```

---

# 17. Redis Key Design

Example:

```text
presence:tenant:{tenantId}:agent:{agentId}

presence:tenant:{tenantId}:visitor:{visitorId}

socket:{connectionId}

agent:sockets:{agentId}

visitor:sockets:{visitorId}

typing:{conversationId}:{userId}
```

Example:

```text
SET presence:tenant:12:agent:91 1 EX 60
```

Refresh the TTL periodically while the connection remains alive.

---

# 18. Horizontal Scaling

Eventually multiple chat servers will run:

```text
                 Load Balancer
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
      Server 1     Server 2     Server 3
          │            │            │
          └────────────┼────────────┘
                       │
                     Redis
```

Suppose:

```text
visitor socket -> Server 1
agent socket   -> Server 3
```

Visitor sends a message.

Server 1:

```text
INSERT PostgreSQL
        ↓
PUBLISH Redis
```

Server 3 receives the Redis event:

```text
Redis
  ↓
Server 3
  ↓
agent websocket
```

---

# 19. Redis Pub/Sub

Example channel:

```text
tenant:12:events
```

Message:

```json
{
    "type": "message.created",
    "conversationId": 123,
    "messageId": 91827
}
```

Another option is conversation-specific channels:

```text
conversation:91827
```

For very large installations, tenant or shard-level channels are usually preferable to creating excessive dynamic subscriptions.

---

# 20. Pub/Sub Is Not Durable

Redis Pub/Sub provides realtime delivery but not durable event storage.

If Server 3 is unavailable:

```text
Server 1
   │
   ▼
Redis publish
   │
   X Server 3 offline
```

the Pub/Sub event may be lost.

This is acceptable because the message still exists in PostgreSQL.

When Server 3 reconnects or the browser reconnects, missed messages are retrieved from the API.

---

# 21. Redis Streams / Queue

Do not introduce a large message broker initially unless needed.

For asynchronous jobs, Redis Streams or a Redis-backed queue can be added.

Example:

```text
message created
      │
      ├── websocket delivery
      │
      └── async jobs
             │
             ├── push notification
             ├── email
             ├── webhook
             ├── analytics
             ├── AI processing
             └── moderation
```

These background tasks require retries more than normal WebSocket broadcasts do.

---

# 22. Presence

Presence should not create a PostgreSQL write every few seconds.

Bad:

```text
heartbeat
    ↓
UPDATE agents SET online = true
```

at large scale.

Instead:

```text
heartbeat
    ↓
Redis
```

Example:

```text
SETEX presence:agent:123 60 online
```

Heartbeat every:

```text
20-30 seconds
```

TTL:

```text
60-90 seconds
```

If heartbeats stop, Redis automatically removes the key.

---

# 23. Typing Indicators

Typing events should never touch PostgreSQL.

Example:

```json
{
    "type": "typing.start",
    "data": {
        "conversationId": "abc"
    }
}
```

Store temporarily or simply broadcast.

Possible Redis TTL:

```text
typing:123:visitor:456
TTL = 5 seconds
```

---

# 24. Read Receipts

Simple model:

```sql
CREATE TABLE conversation_reads (
    conversation_id BIGINT NOT NULL,

    participant_type SMALLINT NOT NULL,

    participant_id BIGINT NOT NULL,

    last_read_message_id BIGINT NOT NULL,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (
        conversation_id,
        participant_type,
        participant_id
    )
);
```

Instead of storing one row per:

```text
message × reader
```

store:

```text
last_read_message_id
```

Example:

```text
last_read_message_id = 100
```

means:

```text
messages <= 100 are read
```

This is dramatically more efficient.

---

# 25. Unread Count

Example:

```sql
SELECT COUNT(*)
FROM messages
WHERE conversation_id = $1
AND id > $2;
```

where `$2` is the participant's `last_read_message_id`.

For very high traffic, unread counts can later be cached or denormalized.

Do not optimize this prematurely.

---

# 26. Attachments

Metadata:

```sql
CREATE TABLE attachments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    tenant_id BIGINT NOT NULL,

    message_id BIGINT,

    storage_key TEXT NOT NULL,

    file_name TEXT,

    mime_type TEXT,

    file_size BIGINT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The API provides a signed URL:

```text
POST /v1/uploads
```

Response:

```json
{
    "uploadUrl": "...",
    "storageKey": "tenant/12/..."
}
```

Then:

```text
Browser ─────────► object storage
```

The API server never needs to proxy the complete upload.

---

# 27. Authentication

Two distinct authentication models are required.

## Agent authentication

Normal application authentication:

```text
email/password
SSO
OAuth
session token
JWT
```

## Widget authentication

Public visitors cannot contain secret credentials inside JavaScript.

The embed script can contain:

```text
site_public_id
```

but never:

```text
tenant_secret
api_secret
private_key
```

For authenticated customer users, the customer's backend can generate signed identity tokens.

Example:

```text
Customer backend
       │
       │ signed visitor token
       ▼
Customer frontend
       │
       ▼
Chat widget
```

This prevents users from impersonating arbitrary customer account IDs.

---

# 28. WebSocket Authentication

A possible flow:

```text
POST /v1/widget/session
```

Server returns:

```json
{
    "sessionToken": "...",
    "visitor": {
        "id": "..."
    }
}
```

Then connect:

```text
wss://chat.example.com/ws?token=...
```

The server validates the short-lived session token before accepting the connection.

Avoid long-lived API keys in URLs.

---

# 29. Origin Validation

Because the widget is embedded in customer websites, validate the requesting origin against the registered tenant site.

Example:

```text
tenant_sites

example-store.com
www.example-store.com
```

On session creation:

```text
Origin: https://www.example-store.com
```

verify:

```text
origin ∈ allowed domains for site ID
```

Origin checking should complement authentication rather than replace it.

---

# 30. Rate Limiting

Rate limit at multiple levels:

```text
IP

tenant

visitor

agent

conversation
```

Redis works well for this.

Examples:

```text
message sends:
30 / 10 seconds

conversation creation:
5 / minute

authentication attempts:
10 / minute
```

Exact limits depend on the product.

---

# 31. WebSocket Backpressure

A common chat architecture mistake is sending indefinitely to slow clients.

Always inspect WebSocket buffering.

Conceptually:

```js
if (socket.bufferedAmount > MAX_BUFFER) {
    socket.close();
}
```

A client that cannot consume messages fast enough must not cause unlimited memory growth.

---

# 32. WebSocket Heartbeats

Implement ping/pong.

Example:

```js
function heartbeat() {
    this.isAlive = true;
}

wss.on('connection', socket => {

    socket.isAlive = true;

    socket.on('pong', heartbeat);

});
```

Periodic check:

```js
const interval = setInterval(() => {

    for (const socket of wss.clients) {

        if (socket.isAlive === false) {
            socket.terminate();
            continue;
        }

        socket.isAlive = false;

        socket.ping();

    }

}, 30000);
```

This detects dead connections that did not cleanly disconnect.

---

# 33. Connection State

Keep lightweight socket state in memory.

Example:

```js
socket.context = {
    connectionId: '...',
    tenantId: 12,
    userType: 'agent',
    userId: 9182
};
```

Do not repeatedly query PostgreSQL for identity information for every WebSocket message.

Authenticate once and attach verified state to the connection.

---

# 34. Local Connection Registry

Each server should maintain something like:

```js
Map<agentId, Set<WebSocket>>
Map<visitorId, Set<WebSocket>>
Map<conversationId, Set<WebSocket>>
```

Example:

```js
const agentSockets = new Map();
```

This makes local delivery cheap.

Redis is only needed when the recipient may be connected to another server.

---

# 35. Database Connection Pool

Each Node process should use a bounded PostgreSQL connection pool.

Example:

```js
import pg from 'pg';

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,

    max: 20,

    idleTimeoutMillis: 30000,

    connectionTimeoutMillis: 5000
});
```

Do not configure huge pools independently on every application instance.

Example:

```text
20 servers
×
100 connections

= 2,000 PostgreSQL connections
```

That is usually unnecessary.

Prefer:

```text
moderate application pools
+
PgBouncer if needed
```

---

# 36. Transactions

Message creation may eventually require:

```text
INSERT message

UPDATE conversation.last_message_id

UPDATE conversation.last_message_at
```

Use a short transaction.

Example:

```sql
BEGIN;

INSERT INTO messages (...);

UPDATE conversations
SET
    last_message_id = $messageId,
    last_message_at = NOW()
WHERE id = $conversationId;

COMMIT;
```

Do not hold transactions open while:

```text
publishing Redis messages
calling external APIs
sending WebSocket messages
performing HTTP requests
```

Commit first.

Then broadcast.

---

# 37. Message Ordering

Within a conversation, the PostgreSQL message ID can initially be used as the ordering cursor.

Example:

```text
100
101
102
103
```

Order:

```sql
ORDER BY id
```

Do not rely exclusively on client timestamps.

Client clocks may be wrong.

---

# 38. Public IDs vs Internal IDs

Internally:

```text
BIGINT
```

is efficient.

Externally:

```text
UUID / UUIDv7 / ULID
```

is preferable.

Example:

```text
internal:

conversation_id = 918273
```

Public API:

```text
conversation public_id =
01991f8e-...
```

This prevents exposing predictable sequential identifiers.

---

# 39. Message Retention

Initially keep all messages.

Later tenants may have different policies:

```text
30 days
90 days
1 year
forever
```

A background cleanup process can delete old messages.

At very large scale, PostgreSQL table partitioning may become useful.

Example:

```text
messages_2026_09
messages_2026_10
messages_2026_11
```

Do not introduce partitioning before there is a real operational need.

---

# 40. PostgreSQL Partitioning

Partitioning becomes useful when the messages table reaches very large sizes and retention/deletion becomes expensive.

Possible design:

```sql
CREATE TABLE messages (
    ...
    created_at TIMESTAMPTZ NOT NULL
)
PARTITION BY RANGE (created_at);
```

Monthly partitions:

```text
messages_2026_09

messages_2026_10

messages_2026_11
```

Benefits:

```text
fast retention cleanup

DROP old partition

smaller indexes

easier maintenance
```

But partitioning introduces additional complexity.

Start without it unless expected message volume clearly requires it.

---

# 41. Suggested Project Layout

```text
chat-service/
│
├── src/
│   │
│   ├── app.js
│   │
│   ├── server.js
│   │
│   ├── config/
│   │   ├── database.js
│   │   └── redis.js
│   │
│   ├── plugins/
│   │   ├── postgres.js
│   │   ├── redis.js
│   │   └── auth.js
│   │
│   ├── routes/
│   │   ├── health.js
│   │   ├── widget.js
│   │   ├── conversations.js
│   │   ├── messages.js
│   │   └── uploads.js
│   │
│   ├── websocket/
│   │   ├── server.js
│   │   ├── connections.js
│   │   ├── protocol.js
│   │   └── handlers/
│   │       ├── message-send.js
│   │       ├── typing.js
│   │       └── read.js
│   │
│   ├── services/
│   │   ├── message-service.js
│   │   ├── conversation-service.js
│   │   ├── presence-service.js
│   │   └── publish-service.js
│   │
│   ├── repositories/
│   │   ├── message-repository.js
│   │   ├── conversation-repository.js
│   │   └── visitor-repository.js
│   │
│   └── workers/
│       ├── notifications.js
│       ├── webhooks.js
│       └── cleanup.js
│
├── migrations/
│
├── test/
│
├── package.json
│
├── Dockerfile
│
├── .env.example
│
└── README.md
```

---

# 42. Recommended Packages

Basic dependencies:

```bash
npm install \
    fastify \
    ws \
    pg \
    redis
```

Possible additional packages:

```bash
npm install \
    @fastify/cors \
    @fastify/rate-limit \
    @fastify/helmet \
    @fastify/jwt
```

Development:

```bash
npm install --save-dev \
    eslint \
    prettier
```

A query builder such as Kysely may also be added.

```bash
npm install kysely
```

Direct `pg` queries are also completely acceptable.

---

# 43. Minimal Server

```js
import Fastify from 'fastify';
import { WebSocketServer } from 'ws';
import pg from 'pg';
import { createClient } from 'redis';

const fastify = Fastify({
    logger: true
});

const postgres = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20
});

const redis = createClient({
    url: process.env.REDIS_URL
});

await redis.connect();

fastify.get('/health', async () => {
    return {
        ok: true
    };
});

await fastify.listen({
    host: '0.0.0.0',
    port: Number(process.env.PORT || 3000)
});

const wss = new WebSocketServer({
    server: fastify.server,
    path: '/ws'
});

wss.on('connection', socket => {

    socket.isAlive = true;

    socket.on('pong', () => {
        socket.isAlive = true;
    });

    socket.on('message', async raw => {

        try {

            const event = JSON.parse(
                raw.toString()
            );

            console.log(event);

        } catch {

            socket.close(
                1003,
                'Invalid message'
            );

        }

    });

});

setInterval(() => {

    for (const socket of wss.clients) {

        if (!socket.isAlive) {
            socket.terminate();
            continue;
        }

        socket.isAlive = false;

        socket.ping();

    }

}, 30000);
```

---

# 44. Environment Variables

Example:

```env
NODE_ENV=production

PORT=3000

DATABASE_URL=postgresql://user:password@postgres:5432/chat

REDIS_URL=redis://redis:6379

JWT_SECRET=change-me

PUBLIC_API_URL=https://api.example.com

PUBLIC_WS_URL=wss://api.example.com/ws
```

---

# 45. Docker Compose for Development

```yaml
services:

  postgres:
    image: postgres:17

    environment:
      POSTGRES_DB: chat
      POSTGRES_USER: chat
      POSTGRES_PASSWORD: chat

    ports:
      - "5432:5432"

    volumes:
      - postgres-data:/var/lib/postgresql/data

  redis:
    image: redis:7

    ports:
      - "6379:6379"

  app:
    build: .

    environment:
      DATABASE_URL: postgresql://chat:chat@postgres:5432/chat
      REDIS_URL: redis://redis:6379

    ports:
      - "3000:3000"

    depends_on:
      - postgres
      - redis

volumes:
  postgres-data:
```

---

# 46. Production Topology

Small deployment:

```text
Cloudflare
    │
    ▼
Load Balancer / Nginx
    │
    ▼
Node.js Chat Server
    │
    ├── PostgreSQL
    │
    └── Redis
```

Larger deployment:

```text
                    Cloudflare
                         │
                         ▼
                    Load Balancer
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
     Chat 1           Chat 2           Chat 3
        │                │                │
        └────────────────┼────────────────┘
                         │
                 ┌───────┴───────┐
                 ▼               ▼
             PostgreSQL         Redis
```

WebSocket connections may remain attached to different servers.

Redis handles cross-server event fan-out.

---

# 47. Sticky Sessions

The architecture should ideally not depend on sticky sessions.

Each WebSocket connection naturally remains on the server that accepted it.

On reconnect, the client may connect to another server.

Because durable state lives in PostgreSQL and realtime coordination is shared through Redis, this should work normally.

Sticky routing can still be used if infrastructure makes it convenient, but it should not be required for correctness.

---

# 48. Scaling Strategy

## Stage 1

```text
1 Node server

1 PostgreSQL

1 Redis
```

This is sufficient for an initial product.

---

## Stage 2

```text
2-5 Node servers

managed PostgreSQL

managed Redis

load balancer
```

Redis handles event propagation.

---

## Stage 3

```text
many WebSocket servers

separate HTTP API servers

worker servers

PgBouncer

PostgreSQL replicas

Redis cluster / managed Redis

object storage + CDN
```

---

## Stage 4

Only after significant scale:

```text
dedicated realtime gateways

NATS / Redis Streams / Kafka

partitioned PostgreSQL

specialized analytics database

regional deployments
```

Do not start here.

---

# 49. When to Consider Something Beyond PostgreSQL

PostgreSQL should comfortably support the first several stages of the product.

Consider specialized message storage only when message volume reaches a level where PostgreSQL operation becomes genuinely difficult.

Possible future technologies:

```text
ScyllaDB

Cassandra

ClickHouse

Kafka

NATS
```

These should solve observed problems rather than anticipated ones.

---

# 50. Avoid Premature Microservices

Start with a modular monolith.

Example:

```text
chat-service
    │
    ├── HTTP API
    ├── WebSocket server
    ├── PostgreSQL
    ├── Redis
    └── workers
```

The code can still be separated into modules.

Later, expensive components can be extracted individually.

Example:

```text
gateway

chat-api

notification-worker

webhook-worker

AI-worker

analytics-worker
```

There is no need for these to be separate services on day one.

---

# 51. Important Design Rules

### PostgreSQL is authoritative

Never rely on WebSocket or Redis as the only copy of a message.

---

### Commit before broadcasting

Correct:

```text
INSERT
COMMIT
PUBLISH
SEND
```

Avoid:

```text
SEND
INSERT
```

---

### Every client message must be retry-safe

Use:

```text
clientMessageId
```

and a database uniqueness constraint.

---

### Do not trust client timestamps

Use server/database ordering.

---

### WebSocket delivery is recoverable

Clients should always be able to reload missing data through HTTP.

---

### Keep transient data out of PostgreSQL

Examples:

```text
typing

online/offline

socket ID

temporary presence
```

These belong in Redis or memory.

---

### Keep binary data out of PostgreSQL

Use object storage.

---

### Never expose tenant secrets in the widget

The browser is an untrusted environment.

---

### Design for multiple browser tabs

One visitor or agent may have:

```text
desktop tab

second browser tab

mobile device
```

Therefore map:

```text
user -> multiple sockets
```

not:

```text
user -> one socket
```

---

# 52. Platform Administration

An internal admin page is useful for support and routine operations, especially once more than one person operates the service. It should be a small control plane over explicit application APIs, not a database editor, shell, or general-purpose server console.

Platform administrators and tenant agents are different identities:

```text
agent                 administers conversations for one tenant
tenant owner          configures their own tenant and team
platform administrator operates the SaaS across tenants
```

Do not grant platform access by adding an `is_admin` flag to `agents`. Agents are tenant-scoped, while a platform administrator may need controlled cross-tenant access. Keeping the concepts separate makes authorization checks and audits harder to bypass accidentally.

## Administrator table

Add a dedicated table when administrators sign in to the application, or when the service needs multiple administrators, individual revocation, roles, or an audit trail. For a very early deployment with one operator, access can temporarily be provided through the identity provider or deployment platform, but shared admin credentials should not be used.

One possible initial schema is:

```sql
CREATE TABLE platform_administrators (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    public_id UUID NOT NULL UNIQUE,

    email TEXT NOT NULL,

    display_name TEXT NOT NULL,

    role TEXT NOT NULL CHECK (role IN (
        'support',
        'operator',
        'super_admin'
    )),

    status SMALLINT NOT NULL DEFAULT 1,

    identity_provider_subject TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    last_login_at TIMESTAMPTZ,

    disabled_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX platform_administrators_email_unique
ON platform_administrators (LOWER(email));

CREATE UNIQUE INDEX platform_administrators_identity_unique
ON platform_administrators (identity_provider_subject)
WHERE identity_provider_subject IS NOT NULL;
```

Prefer SSO or an external identity provider with mandatory MFA. If passwords are stored locally, store only a strong password hash and implement reset, lockout, session revocation, and MFA. Do not store plaintext passwords or reusable recovery codes.

For a small system, the `role` column is sufficient. Introduce role and permission tables only when custom roles are actually required. Authorization must be enforced in the API; hiding buttons in the admin page is not security.

## Admin audit log

Every read of sensitive customer data and every administrative change should be attributable to one administrator:

```sql
CREATE TABLE admin_audit_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    administrator_id BIGINT REFERENCES platform_administrators(id),

    action TEXT NOT NULL,

    target_type TEXT NOT NULL,

    target_id TEXT,

    tenant_id BIGINT REFERENCES tenants(id),

    reason TEXT,

    metadata JSONB,

    ip_address INET,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX admin_audit_log_created_idx
ON admin_audit_log (created_at DESC);

CREATE INDEX admin_audit_log_tenant_idx
ON admin_audit_log (tenant_id, created_at DESC);
```

Treat this log as append-only. Record the administrator, action, affected tenant or resource, timestamp, request ID, and a support reason. Avoid copying message bodies, tokens, passwords, or other secrets into audit metadata.

## Possible admin-page jobs

Start with read-only visibility, then add narrowly defined actions:

```text
System health
    API, WebSocket, PostgreSQL, Redis, object storage, and worker status
    queue depth, failed-job count, error rate, and connection count
    deployed version and migration status

Tenant support
    search and inspect tenants, sites, quotas, and feature settings
    suspend or reactivate a tenant with confirmation and a reason
    review recent errors and delivery failures for one tenant

User support
    inspect agents and visitors with sensitive fields masked by default
    disable an agent or revoke sessions
    resend an invitation or initiate an account recovery flow
    use time-limited impersonation only if it is audited and clearly displayed

Conversation support
    locate a conversation by public ID
    inspect delivery state and metadata
    retry a failed webhook or notification
    export or delete data through controlled privacy workflows

Operations
    inspect failed background jobs and retry an individual safe job
    view webhook attempts and object-storage failures
    enable a feature flag for a tenant
    place the service or one tenant into maintenance mode

Security and compliance
    review administrator activity and suspicious login attempts
    revoke administrator sessions
    process retention, export, and deletion requests
```

High-risk actions should require re-authentication, confirmation, a written reason, and stronger roles. Bulk deletion, arbitrary SQL, arbitrary shell commands, secret viewing, and log tampering should not be available in the page.

Run the admin page on a separate route or application with stricter access controls. Require MFA, short-lived secure sessions, CSRF protection, rate limits, and preferably an identity-aware proxy or VPN. Do not expose it through the public widget authentication flow.

## Automated maintenance jobs

Routine maintenance belongs in idempotent background jobs rather than buttons that must be clicked manually:

```text
frequent
    retry notifications and webhooks with exponential backoff
    remove expired sessions and temporary upload records
    detect stuck or repeatedly failing jobs

daily
    enforce tenant retention policies
    remove orphaned object-storage uploads after a grace period
    aggregate usage for quotas and billing
    verify that backups and workers are healthy

periodic
    test database restore procedures
    rotate signing keys and secrets through a controlled process
    archive old audit records according to policy
    create or drop message partitions, but only if partitioning is enabled
```

Each job should have a stable job ID, bounded batch size, timeout, retry limit, structured logs, metrics, and an alert after final failure. Database backups, PostgreSQL vacuuming, security patches, and infrastructure upgrades should remain the responsibility of the database or deployment platform rather than custom admin-page code.

For the first milestone, a sensible admin page is read-only health and tenant lookup plus session revocation and failed-job retry. Add destructive or cross-tenant tools only after roles, MFA, audit logging, and tested recovery procedures exist.

---

# 53. Recommended Initial Architecture

The final recommended v1 stack is:

```text
Node.js
   │
   ├── Fastify
   │
   └── ws
        │
        ├──────── PostgreSQL
        │
        └──────── Redis
```

With:

```text
PostgreSQL
    durable messages
    conversations
    tenants
    visitors
    agents
    platform administrators
    admin audit log
    read positions
```

```text
Redis
    Pub/Sub
    presence
    typing
    socket routing
    rate limiting
```

```text
ws
    realtime message delivery
```

```text
Fastify
    authentication
    message history
    conversation API
    uploads
    administration
```

```text
Object Storage
    images
    files
    attachments
```

---

# 54. Recommended First Milestone

Build the first version with only:

```text
tenant creation

site configuration

visitor session

agent authentication

conversation creation

send message

message history

WebSocket delivery

Redis Pub/Sub

read state

online presence

platform administrator authentication with MFA

append-only admin audit log

read-only admin health and tenant lookup page
```

Do not initially build:

```text
Kafka

complex microservices

database sharding

multi-region replication

full event sourcing

Cassandra

custom distributed queues
```

Those can be introduced later if actual traffic requires them.

The initial system should remain simple:

```text
                 ┌─────────────┐
                 │ PostgreSQL  │
                 └──────▲──────┘
                        │
                        │ durable state
                        │
Browser ◄──── WS ───► Node.js
                        │
                        │ realtime coordination
                        ▼
                 ┌─────────────┐
                 │    Redis    │
                 └─────────────┘
```

This architecture provides a strong foundation for an embeddable multi-tenant SaaS chat platform while remaining straightforward to operate and scale.
