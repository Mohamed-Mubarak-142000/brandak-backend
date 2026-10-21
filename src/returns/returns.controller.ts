import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, BrandContext, CurrentBrand, CurrentUser, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { ReturnStatus } from './return.schema';
import { CreateReturnDto, RejectReturnDto, ReturnNoteDto, ReturnsQueryDto } from './returns.dto';
import { ReturnsService } from './returns.service';

@ApiTags('Returns')
@ApiBearerAuth()
@Controller()
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get('orders/me/:orderId/returns/eligibility')
  eligibility(@CurrentUser() user: AuthUser, @Param('orderId', ParseObjectIdPipe) orderId: string) {
    return this.returns.eligibility(user.userId, orderId);
  }

  @Post('orders/me/:orderId/returns')
  create(@CurrentUser() user: AuthUser, @Param('orderId', ParseObjectIdPipe) orderId: string, @Body() dto: CreateReturnDto) {
    return this.returns.create(user.userId, orderId, dto);
  }

  @Get('returns/me')
  mine(@CurrentUser() user: AuthUser, @Query() query: ReturnsQueryDto) {
    return this.returns.listMine(user.userId, query);
  }

  @Get('returns/me/:id')
  getMine(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.returns.getMine(user.userId, id);
  }

  @HttpCode(200)
  @Post('returns/me/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.returns.cancel(user.userId, id);
  }
}

@ApiTags('Returns')
@ApiBearerAuth()
@UseGuards(BrandMemberGuard)
@Controller('brand/returns')
export class BrandReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  list(@CurrentBrand() brand: BrandContext, @Query() query: ReturnsQueryDto) {
    return this.returns.listForBrand(brand.brandId, query);
  }

  @Get(':id')
  get(@CurrentBrand() brand: BrandContext, @Param('id', ParseObjectIdPipe) id: string) {
    return this.returns.getForBrand(brand.brandId, id);
  }

  @HttpCode(200)
  @Post(':id/approve')
  approve(@CurrentBrand() brand: BrandContext, @CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: ReturnNoteDto) {
    return this.returns.brandMove(brand.brandId, user.userId, id, ReturnStatus.APPROVED, dto.note);
  }

  @HttpCode(200)
  @Post(':id/reject')
  reject(@CurrentBrand() brand: BrandContext, @CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: RejectReturnDto) {
    return this.returns.brandMove(brand.brandId, user.userId, id, ReturnStatus.REJECTED, dto.note);
  }

  @HttpCode(200)
  @Post(':id/received')
  received(@CurrentBrand() brand: BrandContext, @CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: ReturnNoteDto) {
    return this.returns.brandMove(brand.brandId, user.userId, id, ReturnStatus.RECEIVED, dto.note);
  }

  @HttpCode(200)
  @Post(':id/refunded')
  refunded(@CurrentBrand() brand: BrandContext, @CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: ReturnNoteDto) {
    return this.returns.brandMove(brand.brandId, user.userId, id, ReturnStatus.REFUNDED, dto.note);
  }
}

@ApiTags('Returns')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin/returns')
export class AdminReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  list(@Query() query: ReturnsQueryDto) {
    return this.returns.listAll(query);
  }

  /** Admin can overturn a store's rejection (buyer protection), or push a stuck return along. */
  @HttpCode(200)
  @Post(':id/:status')
  move(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('status') status: string,
    @Body() dto: ReturnNoteDto,
  ) {
    const to = status.toUpperCase() as ReturnStatus;
    return this.returns.adminMove(user.userId, id, to, dto.note);
  }
}
