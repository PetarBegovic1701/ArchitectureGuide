import express from 'express';
import PgBoss from 'pg-boss';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { CreateOrder } from '@tickets/contracts';

const prisma = new PrismaClient();
const boss = new PgBoss(process.env.DATABASE_URL!);
const stripe = new Stripe(process.env.STRIPE_KEY!);
const app = express();
app.use(express.json());

app.post('/orders', async (req, res) => {
  const input = CreateOrder.parse(req.body);
  const intent = await stripe.paymentIntents.create({ amount: input.seats * 1000, currency: 'eur' });
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.ticketOrder.create({ data: { eventId: input.eventId, seats: input.seats, paymentId: intent.id } });
    await boss.send('order-confirmation', { orderId: created.id });
    return created;
  });
  res.status(201).json(order);
});

app.listen(4001);
