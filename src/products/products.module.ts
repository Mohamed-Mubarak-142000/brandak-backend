import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductImportController } from './import/product-import.controller';
import { ProductImportService } from './import/product-import.service';
import { Product, ProductSchema } from './product.schema';
import { BrandProductsController, ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: Product.name, schema: ProductSchema }])],
  controllers: [ProductsController, BrandProductsController, ProductImportController],
  providers: [ProductsService, ProductImportService],
  exports: [ProductsService, MongooseModule],
})
export class ProductsModule {}
