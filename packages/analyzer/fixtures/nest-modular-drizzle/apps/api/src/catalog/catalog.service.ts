import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { products } from './schema';

@Injectable()
export class CatalogService {
  list() {
    return db.select().from(products);
  }

  find(id: string) {
    return db.select().from(products).where(eq(products.id, id));
  }

  async ensureExist(ids: string[]) {
    const found = await db.select().from(products).where(inArray(products.id, ids));
    if (found.length !== ids.length) throw new Error('Unknown product');
  }
}
