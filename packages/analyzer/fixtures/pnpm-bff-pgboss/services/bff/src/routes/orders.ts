import type { FastifyInstance } from 'fastify';
import { CreateOrder } from '@tickets/contracts';

export async function orderRoutes(app: FastifyInstance) {
  app.post('/', async (req) => {
    const body = CreateOrder.parse(req.body);
    const res = await fetch(`${process.env.ORDERS_URL}/orders`, { method: 'POST', body: JSON.stringify(body) });
    return res.json();
  });
}
