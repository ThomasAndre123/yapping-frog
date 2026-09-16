# Yapping Frog

The project architecture and implementation plan live in [project-outline.md](./project-outline.md).

## Local development with Docker

Start the API, PostgreSQL, and Redis:

```bash
docker compose up --build
```

The API is available at <http://localhost:3000>. Check it with:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "message": "Service and dependencies are healthy",
  "service": "yapping-frog",
  "timestamp": "2026-09-16T12:00:00.000Z",
  "uptimeSeconds": 12,
  "checks": {
    "postgres": {
      "status": "ok",
      "message": "Connection successful",
      "latencyMs": 2
    },
    "redis": {
      "status": "ok",
      "message": "Connection successful",
      "latencyMs": 1
    }
  }
}
```

The endpoint returns HTTP `503` with `status: "unavailable"` if PostgreSQL or Redis cannot be reached.

## Database setup and migrations

Do not expose a web-based `/install` route. Even if the route is hidden, it can
be discovered and becomes a privileged production attack surface. Database
changes are installed through versioned SQL migrations instead.

With PostgreSQL running and `.env` configured, run:

```bash
npm run db:migrate
```

The command applies pending files from [`migrations/`](./migrations) in filename
order. It records each migration and its checksum in `schema_migrations`, uses a
PostgreSQL advisory lock to prevent two instances migrating concurrently, and
runs each migration in a transaction. Running it again is safe:

```text
Already applied: 001_create_tenants_and_administrators.sql
Database is up to date.
```

Never edit a migration after it has been applied. Add a new numbered migration
for every later schema change. In production, run migrations as a deployment
step using restricted database credentials; do not run them from an HTTP route
or automatically from every application process.

The first migration creates:

- `tenants` for SaaS customer organizations
- `platform_administrators` for internal operators of the whole service
- `schema_migrations` for migration history

Platform administrators deliberately have no `tenant_id`: they operate the
service itself and are different from tenant agents or tenant owners.

## Optional administration server

The admin UI is an optional plugin. Keep it disabled on normal public app nodes:

```env
ADMIN_ENABLED=false
```

Enable it only on the server instance intended to host administration:

```env
ADMIN_ENABLED=true
ADMIN_SESSION_TTL_HOURS=8
```

After enabling it, restart that instance and open <http://localhost:3000/admin/>.
When disabled, `/admin` and `/api/admin/v1/*` are not registered and return 404.
This supports a deployment where public API/WebSocket nodes do not expose the
administration surface at all. In production, place the enabled instance behind
a VPN or identity-aware proxy as an additional control.

Before logging in, apply migrations and create the first administrator:

```bash
npm run db:migrate
ADMIN_EMAIL=admin@example.com \
ADMIN_NAME="Primary Administrator" \
ADMIN_PASSWORD="use-a-long-unique-password" \
npm run admin:create
```

Avoid saving `ADMIN_PASSWORD` in `.env`; it is needed only by the one-time CLI.
The password is stored as a salted scrypt hash. The UI uses an HTTP-only,
SameSite session cookie and a CSRF token. The initial interface supports:

- administrator login and logout
- listing and creating tenants
- suspending and reactivating tenants
- read-only administrator listing for `super_admin`
- self-service password changes with current-password verification
- revocation of other sessions after a password change
- cursor-paginated audit-log viewing for `super_admin`
- audit records for tenant creation and status changes

The `support` role is read-only. The `operator` and `super_admin` roles can
create tenants and change tenant status.

## WebSocket test

The WebSocket endpoint is available at `ws://localhost:3000/ws`. Start the app,
then open <http://localhost:3000> in a browser. The page is served from
[`public/index.html`](./public/index.html) and can evolve into the client
interface later. Click **Connect**, enter a message, and click **Send**. The page
sends an `echo` event and displays the server's `echo.response` event.

Example request:

```json
{
  "type": "echo",
  "requestId": "request-1",
  "data": { "message": "Hello" }
}
```

Stop the containers with:

```bash
docker compose down
```

To also remove local PostgreSQL, Redis, and dependency volumes:

```bash
docker compose down --volumes
```

## Run the app locally with Docker dependencies

Node.js 22 or newer is required.

```bash
npm install
cp .env.example .env
docker compose up --detach postgres redis
npm run dev
```

The `dev` command loads `.env` automatically. The example connection URLs use
`localhost` because the app runs on your computer while PostgreSQL and Redis run
in containers. Do not use the Compose service names (`postgres` and `redis`) in
`.env`; those names resolve only between containers.

If `.env` already exists, verify these values:

```env
DATABASE_URL=postgresql://chat:chat@localhost:5432/chat
REDIS_URL=redis://localhost:6379
```

Run the tests with:

```bash
npm test
```
