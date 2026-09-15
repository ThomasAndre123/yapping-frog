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
