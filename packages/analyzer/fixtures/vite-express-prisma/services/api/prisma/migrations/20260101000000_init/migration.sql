CREATE TABLE "product" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "price" INTEGER NOT NULL
);

CREATE TABLE "order" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "order_item" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "order"("id"),
  "productId" TEXT NOT NULL REFERENCES "product"("id"),
  "quantity" INTEGER NOT NULL
);

CREATE INDEX "order_item_orderId_idx" ON "order_item"("orderId");
CREATE INDEX "order_item_productId_idx" ON "order_item"("productId");
