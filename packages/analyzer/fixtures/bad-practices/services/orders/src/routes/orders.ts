import { Router } from 'express';
// RNP-005: the route handler talks to the ORM itself, with no use case or repository in between.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

// RNP-015: the request body is used without validation.
router.post('/', async (req, res) => {
  const order = await prisma.order.create({ data: req.body });
  // RNP-001: this service writes the invoice table, and so does billing.
  await prisma.invoice.create({ data: { orderId: order.id, total: req.body.total } });
  res.json(order);
});

export default router;
