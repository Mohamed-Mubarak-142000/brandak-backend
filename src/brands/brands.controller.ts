import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, BrandContext, CurrentBrand, CurrentUser, Public, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import {
  AdminBrandsQueryDto,
  BrandsQueryDto,
  CreateBrandApplicationDto,
  ReasonDto,
  UpdateBrandDto,
} from './brands.dto';
import { BrandsService } from './brands.service';

@ApiTags('Brands')
@Controller()
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Public()
  @Get('brands')
  list(@Query() query: BrandsQueryDto) {
    return this.brands.listPublic(query);
  }

  @ApiBearerAuth()
  @Post('brand-applications')
  apply(@CurrentUser() user: AuthUser, @Body() dto: CreateBrandApplicationDto) {
    return this.brands.apply(user.userId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Get('brands/me')
  me(@CurrentBrand() brand: BrandContext) {
    return this.brands.getMine(brand.brandId);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Patch('brands/me')
  update(@CurrentUser() user: AuthUser, @CurrentBrand() brand: BrandContext, @Body() dto: UpdateBrandDto) {
    return this.brands.updateMine(user.userId, brand.brandId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @HttpCode(200)
  @Post('brands/me/resubmit')
  resubmit(@CurrentUser() user: AuthUser, @CurrentBrand() brand: BrandContext) {
    return this.brands.resubmit(user.userId, brand.brandId);
  }

  // Declared after `brands/me` so "me" is never treated as a slug.
  @Public()
  @Get('brands/:slug')
  bySlug(@Param('slug') slug: string) {
    return this.brands.getPublicBySlug(slug);
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin/brands')
export class AdminBrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  list(@Query() query: AdminBrandsQueryDto) {
    return this.brands.adminList(query);
  }

  @Get(':id')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.brands.adminGet(id);
  }

  @HttpCode(200)
  @Post(':id/approve')
  approve(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.brands.approve(admin.userId, id);
  }

  @HttpCode(200)
  @Post(':id/reject')
  reject(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: ReasonDto) {
    return this.brands.reject(admin.userId, id, dto.reason);
  }

  @HttpCode(200)
  @Post(':id/suspend')
  suspend(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: ReasonDto) {
    return this.brands.suspend(admin.userId, id, dto.reason);
  }

  @HttpCode(200)
  @Post(':id/reinstate')
  reinstate(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.brands.reinstate(admin.userId, id);
  }
}
