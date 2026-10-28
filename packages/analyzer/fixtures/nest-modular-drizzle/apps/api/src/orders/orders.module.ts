import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [CatalogModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
