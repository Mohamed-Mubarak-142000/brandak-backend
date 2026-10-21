import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrdersModule } from '@/orders/orders.module';
import { UsersModule } from '@/users/users.module';
import { AdminSupportController, BrandSupportController, SupportController } from './support.controller';
import { SupportService } from './support.service';
import { SupportTicket, SupportTicketSchema } from './ticket.schema';

@Module({
  imports: [OrdersModule, UsersModule, MongooseModule.forFeature([{ name: SupportTicket.name, schema: SupportTicketSchema }])],
  controllers: [SupportController, BrandSupportController, AdminSupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
