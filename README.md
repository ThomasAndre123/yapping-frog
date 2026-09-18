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

`compose.yaml` is intentionally development-only. It mounts the source tree,
uses the Dockerfile's `development` target, and publishes PostgreSQL and Redis
to the host. Do not use it as the production deployment definition.

## Production with Docker Compose

[`compose.production.yaml`](./compose.production.yaml) is a standalone
single-host production stack. It contains:

- one Nginx gateway that supports HTTP and WebSocket proxying
- multiple public application replicas with the admin plugin disabled
- one PostgreSQL primary with persistent storage
- one Redis instance with append-only persistence
- an optional loopback-only administration instance
- an on-demand migration job

Only `gateway` publishes the public application port. PostgreSQL, Redis, and
the application replicas communicate over private Compose networks. The admin
service binds to `127.0.0.1` by default and must remain behind a VPN,
SSH tunnel, or identity-aware proxy.

Copy the production environment template and replace its example password:

```bash
cp .env.production.example .env.production
```

`POSTGRES_PASSWORD` and the password embedded in `DATABASE_URL` must match. If
the password contains URL-special characters, percent-encode it in
`DATABASE_URL`. Never commit `.env.production`.

Build the production image and apply migrations before starting or updating
the application:

```bash
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml \
  --profile tools run --rm migrate
docker compose --env-file .env.production -f compose.production.yaml up -d
```

The public service is available on `PUBLIC_PORT`, which defaults to 3000. The
default replica count is two. Change `APP_REPLICAS` in `.env.production`, or
override it for a deployment:

```bash
APP_REPLICAS=4 docker compose --env-file .env.production \
  -f compose.production.yaml up -d
```

All replicas use the same PostgreSQL and Redis services. Regular Docker Compose
scales containers only on one Docker host; use an orchestrator or hosting
platform when replicas must span multiple machines.

Start the optional administration instance separately:

```bash
docker compose --env-file .env.production -f compose.production.yaml \
  --profile admin up -d admin
```

It is then reachable only from the Docker host at
`http://127.0.0.1:3001/admin/` unless the bind settings are deliberately
changed. Public application replicas continue to return 404 for `/admin` and
`/api/admin/v1/*`.

Inspect or stop the production stack with the same explicit file and env file:

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs -f app
docker compose --env-file .env.production -f compose.production.yaml down
```

Do not add `--volumes` to the final command during normal operation: that would
delete the Compose-managed PostgreSQL and Redis volumes. Volume persistence is
not a backup; schedule tested PostgreSQL backups to storage outside this Docker
host. For a serious production deployment, managed PostgreSQL and Redis are
preferable, and `DATABASE_URL`/`REDIS_URL` can point to those services instead.

## Database setup and migrations

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

Tenant subscriptions use two columns added by migration 003:

- `subscription_type` is a flexible lowercase plan identifier such as `free`,
  `trial`, `pro`, or `enterprise`.
- `subscription_valid_until` is the expiration instant. A `NULL` value means
  the subscription remains valid forever.

Platform operators and super administrators can edit these values from the
tenant list. Subscription changes are recorded in the administrator audit log.

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
- password changes without interrupting active sessions
- cursor-paginated audit-log viewing for `super_admin`
- audit records for tenant creation and status changes

The `support` role is read-only. The `operator` and `super_admin` roles can
create tenants and change tenant status.

The admin interface is a React/TypeScript application in `frontend/admin`.
Build it before starting the backend directly:

```bash
npm run build:admin
```

For frontend development, run the backend and Vite in separate terminals:

```bash
npm run dev
npm run dev:admin
```

Vite serves the UI at <http://localhost:5173/admin/> and proxies admin API
requests to the backend on port 3000. `npm run build` builds all three reserved
frontend outputs. The future tenant and visitor-widget boundaries live in
`frontend/tenant` and `frontend/widget`; they intentionally contain no product
UI yet.

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
