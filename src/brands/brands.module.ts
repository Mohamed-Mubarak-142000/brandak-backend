import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Brand, BrandSchema } from './brand.schema';
import { AdminBrandsController, BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: Brand.name, schema: BrandSchema }])],
  controllers: [BrandsController, AdminBrandsController],
  providers: [BrandsService],
  exports: [BrandsService, MongooseModule],
})
export class BrandsModule {}
