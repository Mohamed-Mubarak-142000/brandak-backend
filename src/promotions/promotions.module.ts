import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminPromotionsController, PromotionsController } from './promotions.controller';
import { Campaign, CampaignSchema, Coupon, CouponRedemption, CouponRedemptionSchema, CouponSchema } from './promotion.schemas';
import { PromotionsService } from './promotions.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Coupon.name, schema: CouponSchema },
      { name: CouponRedemption.name, schema: CouponRedemptionSchema },
      { name: Campaign.name, schema: CampaignSchema },
    ]),
  ],
  controllers: [PromotionsController, AdminPromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
