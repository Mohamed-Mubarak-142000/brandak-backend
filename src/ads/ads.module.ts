import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '@/users/users.module';
import { Ad, AdSchema } from './ad.schema';
import { AdminAdsController, AdsController } from './ads.controller';
import { AdsService } from './ads.service';

@Global()
@Module({
  imports: [UsersModule, MongooseModule.forFeature([{ name: Ad.name, schema: AdSchema }])],
  controllers: [AdsController, AdminAdsController],
  providers: [AdsService],
  exports: [AdsService],
})
export class AdsModule {}
