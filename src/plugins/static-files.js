import path from 'node:path';
import { fileURLToPath } from 'node:url';

import staticPlugin from '@fastify/static';
import fp from 'fastify-plugin';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(currentDirectory, '../../public');

async function staticFilesPlugin(app) {
  await app.register(staticPlugin, {
    root: publicDirectory,
    index: 'index.html'
  });
}

export default fp(staticFilesPlugin, {
  name: 'static-files'
});
