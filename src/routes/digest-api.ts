import type { Hono } from 'hono';
import { readNight } from '../digest/index.js';

export function registerDigestApi(app: Hono, runsDir: string): void {
  app.get('/api/digest/:night', (c) => {
    const digest = readNight(runsDir, c.req.param('night'));
    return digest === null
      ? c.json({ error: 'night not found' }, 404)
      : c.json(digest);
  });
}
