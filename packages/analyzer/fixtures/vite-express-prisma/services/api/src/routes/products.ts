import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

router.get('/', async (_req, res) => {
  res.json(await prisma.product.findMany());
});

router.get('/:id', async (req, res) => {
  res.json(await prisma.product.findUnique({ where: { id: req.params.id } }));
});

export default router;
