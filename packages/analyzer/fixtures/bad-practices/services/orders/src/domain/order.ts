// RNP-006: the domain depends on the ORM.
import { Prisma } from '@prisma/client';

export function totalOf(order: { lines: { price: Prisma.Decimal }[] }) {
  return order.lines.reduce((sum, l) => sum.add(l.price), new Prisma.Decimal(0));
}
