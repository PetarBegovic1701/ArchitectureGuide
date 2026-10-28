import Fastify from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = Fastify();

app.get('/events', async () => (await pool.query('SELECT id, name FROM catalog.event ORDER BY starts_at')).rows);

app.post('/events', async (req) => {
  const body = z.object({ name: z.string() }).parse(req.body);
  await pool.query('INSERT INTO catalog.event (name) VALUES ($1)', [body.name]);
});

await app.listen({ port: 4002 });
