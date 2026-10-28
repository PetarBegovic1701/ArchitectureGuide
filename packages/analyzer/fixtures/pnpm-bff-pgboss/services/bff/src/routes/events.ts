import type { FastifyInstance } from 'fastify';

export async function eventRoutes(app: FastifyInstance) {
  app.get('/', async () => (await fetch(`${process.env.CATALOG_URL}/events`)).json());
}
