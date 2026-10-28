import { index, pgSchema, text, uuid } from 'drizzle-orm/pg-core';

export const ordersSchema = pgSchema('orders');

export const orders = ordersSchema.table('order', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: text('status').notNull(),
});

export const orderLines = ordersSchema.table(
  'order_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull().references(() => orders.id),
    productId: uuid('product_id').notNull(),
  },
  (t) => [index('order_line_order_idx').on(t.orderId)],
);
