import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { Model, Types } from 'mongoose';
import { AuthUser, CurrentUser } from '@/common/decorators';
import { ProductStatus } from '@/common/enums';
import { AppError } from '@/common/errors';
import { Lean, PageQueryDto, PageResult, paginate } from '@/common/pagination';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { CustomerOnlyGuard } from '@/common/guards/customer-only.guard';
import { BrandsService } from '@/brands/brands.service';
import { Product } from '@/products/product.schema';
import { ProductsService } from '@/products/products.service';
import { WishlistItem, WishlistItemSchema } from './wishlist.schema';

class AddWishlistItemDto {
  @IsMongoId()
  productId: string;
}

@Injectable()
export class WishlistsService {
  constructor(
    @InjectModel(WishlistItem.name) private readonly items: Model<WishlistItem>,
    @InjectModel(Product.name) private readonly productModel: Model<Product>,
    private readonly products: ProductsService,
    private readonly brands: BrandsService,
  ) {}

  async list(userId: string, query: PageQueryDto) {
    const page = await paginate(this.items, { userId: new Types.ObjectId(userId) }, query, {
      populate: 'productId',
    });
    const visible = new Set((await this.brands.visibleBrandIds()).map(String));
    const items = page.items.map((row) => {
      const product = row.productId as unknown as Lean<Product> | null;
      const available =
        !!product && product.status === ProductStatus.ACTIVE && visible.has(product.brandId.toString());
      return {
        productId: product?._id.toString() ?? row.productId.toString(),
        addedAt: row.createdAt,
        available,
        product: product && available ? this.products.toCard(product) : null,
      };
    });
    return new PageResult(items, page.page, page.limit, page.total);
  }

  async add(userId: string, productId: string) {
    const exists = await this.productModel.exists({ _id: productId, status: ProductStatus.ACTIVE });
    if (!exists) throw AppError.notFound('Product');
    await this.items.updateOne(
      { userId: new Types.ObjectId(userId), productId: new Types.ObjectId(productId) },
      { $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
  }

  async remove(userId: string, productId: string) {
    await this.items.deleteOne({ userId: new Types.ObjectId(userId), productId: new Types.ObjectId(productId) });
  }

  async productIds(userId: string) {
    const rows = await this.items.find({ userId: new Types.ObjectId(userId) }).select('productId').lean();
    return rows.map((r) => r.productId.toString());
  }
}

@ApiTags('Customer')
@ApiBearerAuth()
@UseGuards(CustomerOnlyGuard)
@Controller('wishlists/me')
export class WishlistsController {
  constructor(private readonly wishlists: WishlistsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
    return this.wishlists.list(user.userId, query);
  }

  /** Just the ids, so the app can render heart icons without loading full products. */
  @Get('ids')
  ids(@CurrentUser() user: AuthUser) {
    return this.wishlists.productIds(user.userId);
  }

  @Post('items')
  @HttpCode(204)
  add(@CurrentUser() user: AuthUser, @Body() dto: AddWishlistItemDto) {
    return this.wishlists.add(user.userId, dto.productId);
  }

  @Delete('items/:productId')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('productId', ParseObjectIdPipe) productId: string) {
    return this.wishlists.remove(user.userId, productId);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: WishlistItem.name, schema: WishlistItemSchema }])],
  controllers: [WishlistsController],
  providers: [WishlistsService],
})
export class WishlistsModule {}
