import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createDatabase } from './db.js';
import { createApp } from './app.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = createApp(createDatabase());
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(root, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true, allowedHosts: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log(`InduPort running on port ${port} (${process.env.NODE_ENV || 'development'})`));
