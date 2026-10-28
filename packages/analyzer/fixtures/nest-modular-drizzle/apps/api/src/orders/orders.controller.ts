import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsArray, IsString } from 'class-validator';
import { OrdersService } from './orders.service';

class CreateOrderDto {
  @IsArray()
  @IsString({ each: true })
  productIds!: string[];
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto.productIds);
  }

  @Get(':id')
  find(@Param('id') id: string) {
    return this.orders.find(id);
  }
}
