import { pgSchema, text, uuid } from 'drizzle-orm/pg-core';

export const usersSchema = pgSchema('users');

export const users = usersSchema.table('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
});
