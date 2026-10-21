import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsInt, IsMongoId, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { AuthUser, BrandContext, CurrentBrand, CurrentUser, Public, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { PageQueryDto } from '@/common/pagination';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { AdPlacement, AdStatus } from './ad.schema';
import { AdsService } from './ads.service';

class CreateAdDto {
  @IsMongoId() productId: string;
  @IsEnum(AdPlacement) placement: AdPlacement;
  @IsInt() @Min(1) @Max(4) weeks: number;
  @IsMongoId() proofFileId: string;
  @IsString() @Length(4, 64) transactionReference: string;
}
class AdsQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(AdStatus) status?: AdStatus;
}
class RejectAdDto {
  @IsString() @Length(3, 500) reason: string;
}
class AdPricesDto {
  @IsOptional() @IsInt() @Min(0) @Max(100000) SEARCH_TOP?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) CATEGORY_TOP?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) HOME_BANNER?: number;
}

@ApiTags('Ads')
@Controller()
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Public()
  @Get('ads/prices')
  prices() {
    return this.ads.prices();
  }

  @Public()
  @HttpCode(204)
  @Post('ads/:id/click')
  async click(@Param('id', ParseObjectIdPipe) id: string) {
    await this.ads.click(id);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Get('brand/ads')
  mine(@CurrentBrand() brand: BrandContext, @Query() query: PageQueryDto) {
    return this.ads.listForBrand(brand.brandId, query);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Post('brand/ads')
  create(@CurrentUser() user: AuthUser, @CurrentBrand() brand: BrandContext, @Body() dto: CreateAdDto) {
    return this.ads.create(user.userId, brand.brandId, dto);
  }
}

@ApiTags('Ads')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin/ads')
export class AdminAdsController {
  constructor(private readonly ads: AdsService) {}

  @Get()
  list(@Query() query: AdsQueryDto) {
    return this.ads.listAll(query);
  }

  @Put('prices')
  updatePrices(@CurrentUser() user: AuthUser, @Body() dto: AdPricesDto) {
    return this.ads.updatePrices(user.userId, dto);
  }

  @Get(':id/proof')
  proof(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.ads.proofUrl(user.userId, id);
  }

  @HttpCode(200)
  @Post(':id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.ads.approve(user.userId, id);
  }

  @HttpCode(200)
  @Post(':id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: RejectAdDto) {
    return this.ads.reject(user.userId, id, dto.reason);
  }
}
