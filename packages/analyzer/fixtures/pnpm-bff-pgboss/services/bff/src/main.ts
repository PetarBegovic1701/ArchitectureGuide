import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { orderRoutes } from './routes/orders';
import { eventRoutes } from './routes/events';

const app = Fastify();
await app.register(jwt, { secret: process.env.JWT_SECRET! });
await app.register(orderRoutes, { prefix: '/api/orders' });
await app.register(eventRoutes, { prefix: '/api/events' });
await app.listen({ port: 4000 });
