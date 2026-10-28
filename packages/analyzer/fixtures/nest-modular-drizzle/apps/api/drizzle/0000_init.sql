CREATE SCHEMA "orders";
CREATE SCHEMA "catalog";
CREATE SCHEMA "users";
CREATE TABLE "catalog"."product" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "name" text NOT NULL, "price" integer NOT NULL);
CREATE TABLE "orders"."order" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "status" text NOT NULL);
CREATE TABLE "orders"."order_line" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "order_id" uuid NOT NULL REFERENCES "orders"."order"("id"), "product_id" uuid NOT NULL);
CREATE INDEX "order_line_order_idx" ON "orders"."order_line" ("order_id");
CREATE TABLE "users"."user" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "email" text NOT NULL UNIQUE);
