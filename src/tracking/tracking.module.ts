import { Body, Controller, Get, Global, HttpCode, Module, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { Model } from 'mongoose';
import { BrandContext, CurrentBrand, OptionalUser, Public, type AuthUser } from '@/common/decorators';
import { ProductStatus } from '@/common/enums';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { Product } from '@/products/product.schema';
import { unitPriceNow } from '@/promotions/price-math';
import { UsersService } from '@/users/users.service';
import { UsersModule } from '@/users/users.module';
import { TRACKING_HTTP, TrackingService } from './tracking.service';

class TrackingDto {
  @IsOptional() @IsString() @Matches(/^\d{0,20}$/, { message: 'metaPixelId must be digits' }) metaPixelId?: string;
  @IsOptional() @IsString() @MaxLength(500) metaAccessToken?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z0-9]{0,30}$/i, { message: 'tiktokPixelId must be letters and digits' }) tiktokPixelId?: string;
  @IsOptional() @IsString() @MaxLength(500) tiktokAccessToken?: string;
}

@ApiTags('Tracking')
@Controller()
export class TrackingController {
  constructor(
    private readonly tracking: TrackingService,
    private readonly users: UsersService,
    @InjectModel(Product.name) private readonly products: Model<Product>,
  ) {}

  /** The app reports a product view (the product endpoint itself is CDN-cached). */
  @Public()
  @HttpCode(204)
  @Post('products/:id/view')
  async view(@Param('id', ParseObjectIdPipe) id: string, @Req() req: Request, @OptionalUser() viewer?: AuthUser) {
    const p = await this.products.findOne({ _id: id, status: ProductStatus.ACTIVE }).select('brandId price sale').lean();
    if (!p) return;
    const user = viewer ? await this.users.getById(viewer.userId).catch(() => null) : null;
    await this.tracking.event(p.brandId, 'ViewContent', {
      contents: [{ id, quantity: 1, price: unitPriceNow(p, {}) }],
      user: user && { id: user._id.toString(), email: user.email, phone: user.phone },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Get('brand/tracking')
  get(@CurrentBrand() brand: BrandContext) {
    return this.tracking.forBrand(brand.brandId);
  }

  /** Empty strings clear a value. Tokens are stored but never shown again. */
  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Put('brand/tracking')
  update(@CurrentBrand() brand: BrandContext, @Body() dto: TrackingDto) {
    return this.tracking.update(brand.brandId, dto);
  }
}

@Global()
@Module({
  imports: [UsersModule],
  controllers: [TrackingController],
  providers: [TrackingService, { provide: TRACKING_HTTP, useValue: (url: string, init: RequestInit) => fetch(url, init) }],
  exports: [TrackingService],
})
export class TrackingModule {}
