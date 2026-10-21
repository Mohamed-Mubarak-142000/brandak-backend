import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsHexColor, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { PublicCache } from '@/common/cache';
import { AuthUser, BrandContext, CurrentBrand, CurrentUser, Public, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { CouponType } from './promotion.schemas';
import { PromotionsService } from './promotions.service';

class CouponDto {
  @Matches(/^[A-Za-z0-9_-]{3,20}$/, { message: 'code must be 3-20 letters, digits, - or _' })
  code: string;

  @IsEnum(CouponType) type: CouponType;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(100_000) value: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) maxDiscount?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) minSubtotal?: number;
  @IsOptional() @IsInt() @Min(1) maxUses?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(100) perUserLimit?: number;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsDateString() endsAt: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateCouponDto extends PartialType(CouponDto) {}

class CampaignDto {
  @IsString() @Length(2, 60) nameAr: string;
  @Matches(/^[a-z0-9-]{2,40}$/) slug: string;
  @IsOptional() @IsString() @MaxLength(300) descriptionAr?: string;
  @IsDateString() startsAt: string;
  @IsDateString() endsAt: string;
  @IsOptional() @IsInt() @Min(1) @Max(90) minPercent?: number;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateCampaignDto extends PartialType(CampaignDto) {}

@ApiTags('Promotions')
@Controller()
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  /** Running and upcoming seasons for the home banner. */
  @Public()
  @PublicCache(120)
  @Get('campaigns')
  campaigns() {
    return this.promotions.activeCampaigns();
  }

  @Public()
  @PublicCache(120)
  @Get('campaigns/:slug')
  campaign(@Param('slug') slug: string) {
    return this.promotions.campaignBySlug(slug);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Get('brand/coupons')
  myCoupons(@CurrentBrand() brand: BrandContext) {
    return this.promotions.listCoupons(brand.brandId);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Post('brand/coupons')
  createMine(@CurrentUser() user: AuthUser, @CurrentBrand() brand: BrandContext, @Body() dto: CouponDto) {
    return this.promotions.createCoupon(user.userId, brand.brandId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Patch('brand/coupons/:id')
  updateMine(@CurrentBrand() brand: BrandContext, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateCouponDto) {
    return this.promotions.updateCoupon(brand.brandId, id, dto);
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin')
export class AdminPromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  /** Fatrina-wide coupons (valid in every store; the platform pays the discount). */
  @Get('coupons')
  coupons() {
    return this.promotions.listCoupons(null);
  }

  @Post('coupons')
  createCoupon(@CurrentUser() user: AuthUser, @Body() dto: CouponDto) {
    return this.promotions.createCoupon(user.userId, null, dto);
  }

  @Patch('coupons/:id')
  updateCoupon(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateCouponDto) {
    return this.promotions.updateCoupon(null, id, dto);
  }

  @Get('campaigns')
  campaigns() {
    return this.promotions.listCampaigns();
  }

  @Post('campaigns')
  createCampaign(@CurrentUser() user: AuthUser, @Body() dto: CampaignDto) {
    return this.promotions.createCampaign(user.userId, dto);
  }

  @Patch('campaigns/:id')
  updateCampaign(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateCampaignDto) {
    return this.promotions.updateCampaign(user.userId, id, dto);
  }
}
