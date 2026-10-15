import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, BrandContext, CurrentBrand, CurrentUser, Public } from '@/common/decorators';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { BrandsService } from '@/brands/brands.service';
import {
  AdjustStockDto,
  BrandProductsQueryDto,
  CreateProductDto,
  ProductsQueryDto,
  UpdateProductDto,
} from './products.dto';
import { ProductsService } from './products.service';

@ApiTags('Catalog')
@Controller()
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly brands: BrandsService,
  ) {}

  @Public()
  @Get('products')
  search(@Query() query: ProductsQueryDto) {
    return this.products.search(query);
  }

  @Public()
  @Get('products/:id')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.products.getPublic(id);
  }

  @Public()
  @Get('brands/:slug/products')
  async brandProducts(@Param('slug') slug: string, @Query() query: ProductsQueryDto) {
    const brand = await this.brands.getPublicBySlug(slug);
    return this.products.search({ ...query, brandId: brand.id });
  }
}

@ApiTags('Brand dashboard')
@ApiBearerAuth()
@UseGuards(BrandMemberGuard)
@Controller('brand/products')
export class BrandProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@CurrentBrand() brand: BrandContext, @Query() query: BrandProductsQueryDto) {
    return this.products.listForBrand(brand.brandId, query);
  }

  @Get(':id')
  get(@CurrentBrand() brand: BrandContext, @Param('id', ParseObjectIdPipe) id: string) {
    return this.products.getForBrand(brand.brandId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @CurrentBrand() brand: BrandContext, @Body() dto: CreateProductDto) {
    return this.products.create(user.userId, brand.brandId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @CurrentBrand() brand: BrandContext,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(user.userId, brand.brandId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  archive(@CurrentBrand() brand: BrandContext, @Param('id', ParseObjectIdPipe) id: string) {
    return this.products.archive(brand.brandId, id);
  }

  @Post(':id/variants/:variantId/stock')
  @HttpCode(200)
  adjustStock(
    @CurrentBrand() brand: BrandContext,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('variantId', ParseObjectIdPipe) variantId: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.products.adjustStock(brand.brandId, id, variantId, dto.delta);
  }
}
