import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrdersModule } from '@/orders/orders.module';
import { UsersModule } from '@/users/users.module';
import { Report, ReportSchema, Review, ReviewSchema } from './review.schema';
import { AdminModerationController, ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [
    OrdersModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: Review.name, schema: ReviewSchema },
      { name: Report.name, schema: ReportSchema },
    ]),
  ],
  controllers: [ReviewsController, AdminModerationController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
