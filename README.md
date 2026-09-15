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
{"ok":true,"service":"yapping-frog"}
```

Stop the containers with:

```bash
docker compose down
```

To also remove local PostgreSQL, Redis, and dependency volumes:

```bash
docker compose down --volumes
```

## Local development without Docker

Node.js 22 or newer is required.

```bash
npm install
npm run dev
```

Run the tests with:

```bash
npm test
```
