import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openDatabase } from './storage.js';
import { ensureAdmin } from './auth.js';
import { createApp } from './app.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if(process.argv.includes('--production'))process.env.NODE_ENV='production';
const store=await openDatabase();
await ensureAdmin(store);
const app = createApp(store);

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(root, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true, allowedHosts: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
const server=app.listen(port, '0.0.0.0', () => console.log(`InduPort running on port ${port} (${process.env.NODE_ENV || 'development'})`));

let shuttingDown=false;
const shutdown=()=>{if(shuttingDown)return;shuttingDown=true;server.close(async()=>{await store.close();process.exit(0)})};
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
