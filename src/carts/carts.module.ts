import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Cart, CartSchema } from './cart.schema';
import { CartsController } from './carts.controller';
import { CartsService } from './carts.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Cart.name, schema: CartSchema }])],
  controllers: [CartsController],
  providers: [CartsService],
  exports: [CartsService, MongooseModule],
})
export class CartsModule {}
