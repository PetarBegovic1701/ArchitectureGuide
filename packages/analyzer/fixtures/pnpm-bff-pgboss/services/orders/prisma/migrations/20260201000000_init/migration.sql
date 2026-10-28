CREATE SCHEMA IF NOT EXISTS "orders";
CREATE TABLE "orders"."ticket_order" ("id" TEXT PRIMARY KEY, "eventId" TEXT NOT NULL, "seats" INTEGER NOT NULL, "paymentId" TEXT NOT NULL);
