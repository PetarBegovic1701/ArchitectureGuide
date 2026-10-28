import { integer, pgSchema, text, uuid } from 'drizzle-orm/pg-core';

export const catalogSchema = pgSchema('catalog');

export const products = catalogSchema.table('product', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  price: integer('price').notNull(),
});
