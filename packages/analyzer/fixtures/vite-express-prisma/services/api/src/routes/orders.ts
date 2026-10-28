import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';

const router = Router();

const NewOrder = z.object({
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })),
});

router.post('/', async (req, res) => {
  const input = NewOrder.parse(req.body);
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({ data: { status: 'new' } });
    await tx.orderItem.createMany({
      data: input.items.map((i) => ({ ...i, orderId: created.id })),
    });
    return created;
  });
  res.status(201).json(order);
});

router.get('/:id', async (req, res) => {
  res.json(await prisma.order.findUnique({ where: { id: req.params.id }, include: { items: true } }));
});

export default router;
