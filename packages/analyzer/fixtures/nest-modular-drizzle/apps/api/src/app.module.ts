import { Module } from '@nestjs/common';
import { CatalogModule } from './catalog/catalog.module';
import { OrdersModule } from './orders/orders.module';
import { UsersModule } from './users/users.module';

@Module({ imports: [OrdersModule, CatalogModule, UsersModule] })
export class AppModule {}
