import Fastify from 'fastify';
import { Pool } from 'pg';

const pool = new Pool();
const app = Fastify();

// RNP-015: no schema validation; RNP-001: writes the invoice table owned by orders.
app.post('/invoices/:id/pay', async (req) => {
  await pool.query('UPDATE invoice SET total = 0 WHERE id = $1', [(req.params as { id: string }).id]);
  return { ok: true };
});

await app.listen({ port: 3001 });
