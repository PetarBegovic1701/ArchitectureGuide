import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { CatalogService } from '../catalog/catalog.service';
import { orderLines, orders } from './schema';

@Injectable()
export class OrdersService {
  constructor(private readonly catalog: CatalogService) {}

  async create(productIds: string[]) {
    await this.catalog.ensureExist(productIds);
    return db.transaction(async (tx) => {
      const [order] = await tx.insert(orders).values({ status: 'new' }).returning();
      await tx.insert(orderLines).values(productIds.map((productId) => ({ orderId: order!.id, productId })));
      return order;
    });
  }

  find(id: string) {
    return db.select().from(orders).where(eq(orders.id, id));
  }
}
