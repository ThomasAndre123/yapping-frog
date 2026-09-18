FROM node:22-alpine AS development

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]

FROM node:22-alpine AS production

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
# NODE_ENV=production makes npm omit dev dependencies by default. Vite and
# TypeScript are build-only dependencies, so include them for the asset build
# and prune them from the final runtime installation afterwards.
RUN npm ci --include=dev

COPY src ./src
COPY public ./public
COPY frontend ./frontend
COPY migrations ./migrations
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

USER node

EXPOSE 3000

CMD ["npm", "start"]
