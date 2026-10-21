import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AddressesModule } from '@/addresses/addresses.module';
import { CartsModule } from '@/carts/carts.module';
import { UsersModule } from '@/users/users.module';
import { CheckoutService } from './checkout.service';
import { BrandBlock, BrandBlockSchema } from './brand-block.schema';
import { Counter, CounterSchema, Order, OrderSchema } from './order.schema';
import { AdminOrdersController, BrandOrdersController, CustomerOrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    AddressesModule,
    CartsModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: BrandBlock.name, schema: BrandBlockSchema },
    ]),
  ],
  controllers: [CustomerOrdersController, BrandOrdersController, AdminOrdersController],
  providers: [CheckoutService, OrdersService],
  exports: [OrdersService, MongooseModule],
})
export class OrdersModule {}
