import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrdersModule } from '@/orders/orders.module';
import { UsersModule } from '@/users/users.module';
import { ReturnRequest, ReturnRequestSchema } from './return.schema';
import { AdminReturnsController, BrandReturnsController, ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

@Module({
  imports: [OrdersModule, UsersModule, MongooseModule.forFeature([{ name: ReturnRequest.name, schema: ReturnRequestSchema }])],
  controllers: [ReturnsController, BrandReturnsController, AdminReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
