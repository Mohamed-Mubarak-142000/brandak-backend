import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsMongoId, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { PublicCache } from '@/common/cache';
import { AuthUser, BrandContext, CurrentBrand, CurrentUser, Public, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { PageQueryDto } from '@/common/pagination';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { SettlementStatus } from './commission.schemas';
import { CommissionsService } from './commissions.service';

class SubmitSettlementDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  amount: number;

  @IsMongoId()
  proofFileId: string;

  @IsString()
  @Length(4, 64)
  transactionReference: string;
}

class UpdateTermsDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(0.5) commissionRate?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(90) settlementDays?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000) maxUnpaidBalance?: number;
}

class SettlementsQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(SettlementStatus) status?: SettlementStatus;
}

class RejectDto {
  @IsString() @Length(3, 500) reason: string;
}

class AdjustDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(-1_000_000) @Max(1_000_000) amount: number;
  @IsString() @MaxLength(300) note: string;
}

@ApiTags('Commission')
@Controller()
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  /** The current terms, shown to stores when they open and in the help pages. */
  @Public()
  @PublicCache(300)
  @Get('platform/terms')
  terms() {
    return this.commissions.terms();
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Get('brand/commissions')
  status(@CurrentBrand() brand: BrandContext) {
    return this.commissions.statusFor(brand.brandId);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Get('brand/commissions/ledger')
  ledger(@CurrentBrand() brand: BrandContext, @Query() query: PageQueryDto) {
    return this.commissions.ledgerFor(brand.brandId, query);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Get('brand/commissions/settlements')
  mySettlements(@CurrentBrand() brand: BrandContext, @Query() query: PageQueryDto) {
    return this.commissions.settlementsFor(brand.brandId, query);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Post('brand/commissions/settlements')
  submit(@CurrentUser() user: AuthUser, @CurrentBrand() brand: BrandContext, @Body() dto: SubmitSettlementDto) {
    return this.commissions.submitSettlement(user.userId, brand.brandId, dto);
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin')
export class AdminCommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get('platform-settings')
  terms() {
    return this.commissions.terms();
  }

  @Patch('platform-settings')
  updateTerms(@CurrentUser() user: AuthUser, @Body() dto: UpdateTermsDto) {
    return this.commissions.updateTerms(user.userId, dto);
  }

  @Get('commissions/summary')
  summary() {
    return this.commissions.summary();
  }

  @Get('commissions/brands')
  brands() {
    return this.commissions.brandBalances();
  }

  @Get('commissions/brands/:brandId')
  brand(@Param('brandId', ParseObjectIdPipe) brandId: string) {
    return this.commissions.statusFor(brandId);
  }

  @Get('commissions/brands/:brandId/ledger')
  brandLedger(@Param('brandId', ParseObjectIdPipe) brandId: string, @Query() query: PageQueryDto) {
    return this.commissions.ledgerFor(brandId, query);
  }

  @Post('commissions/brands/:brandId/adjust')
  @HttpCode(200)
  adjust(@CurrentUser() user: AuthUser, @Param('brandId', ParseObjectIdPipe) brandId: string, @Body() dto: AdjustDto) {
    return this.commissions.adjust(user.userId, brandId, dto.amount, dto.note);
  }

  @Get('settlements')
  settlements(@Query() query: SettlementsQueryDto) {
    return this.commissions.listSettlements(query);
  }

  @Get('settlements/:id/proof-url')
  proof(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.commissions.proofUrl(user.userId, id);
  }

  @Post('settlements/:id/approve')
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.commissions.approveSettlement(user.userId, id);
  }

  @Post('settlements/:id/reject')
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: RejectDto) {
    return this.commissions.rejectSettlement(user.userId, id, dto.reason);
  }
}
