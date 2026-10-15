import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AuthUser,
  BrandContext,
  CurrentBrand,
  CurrentUser,
  IdempotencyKey,
  Roles,
} from '@/common/decorators';
import { Role } from '@/common/enums';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { PageQueryDto } from '@/common/pagination';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { CheckoutService } from './checkout.service';
import {
  AdminCancelOrderDto,
  AdminOrdersQueryDto,
  BrandOrdersQueryDto,
  CancelOrderDto,
  OrdersQueryDto,
  PlaceOrderDto,
  QuoteDto,
  UpdateOrderStatusDto,
} from './orders.dto';
import { OrdersService } from './orders.service';

@ApiTags('Customer')
@ApiBearerAuth()
@Controller()
export class CustomerOrdersController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly orders: OrdersService,
  ) {}

  @HttpCode(200)
  @Post('checkout/:brandId/quote')
  quote(@CurrentUser() user: AuthUser, @Param('brandId', ParseObjectIdPipe) brandId: string, @Body() dto: QuoteDto) {
    return this.checkout.quote(user.userId, brandId, dto);
  }

  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Unique per checkout attempt (e.g. a UUID)' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('checkout/:brandId/orders')
  place(
    @CurrentUser() user: AuthUser,
    @Param('brandId', ParseObjectIdPipe) brandId: string,
    @Body() dto: PlaceOrderDto,
    @IdempotencyKey() key?: string,
  ) {
    return this.checkout.placeOrder(user.userId, brandId, dto, key);
  }

  @Get('orders/me')
  list(@CurrentUser() user: AuthUser, @Query() query: OrdersQueryDto) {
    return this.orders.listMine(user.userId, query);
  }

  @Get('orders/me/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.orders.getMine(user.userId, id);
  }

  @HttpCode(200)
  @Post('orders/me/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: CancelOrderDto) {
    return this.orders.cancelByCustomer(user.userId, id, dto.reason);
  }
}

@ApiTags('Brand dashboard')
@ApiBearerAuth()
@UseGuards(BrandMemberGuard)
@Controller('brand')
export class BrandOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders')
  list(@CurrentBrand() brand: BrandContext, @Query() query: BrandOrdersQueryDto) {
    return this.orders.listForBrand(brand.brandId, query);
  }

  @Get('orders/:id')
  get(@CurrentBrand() brand: BrandContext, @Param('id', ParseObjectIdPipe) id: string) {
    return this.orders.getForBrand(brand.brandId, id);
  }

  @Patch('orders/:id/status')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @CurrentBrand() brand: BrandContext,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.orders.updateByBrand(user.userId, brand.brandId, id, dto.status, dto.note);
  }

  @Get('customers')
  customers(@CurrentBrand() brand: BrandContext, @Query() query: PageQueryDto) {
    return this.orders.brandCustomers(brand.brandId, query);
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query() query: AdminOrdersQueryDto) {
    return this.orders.listAll(query);
  }

  @Get(':id')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.orders.getAny(id);
  }

  @HttpCode(200)
  @Post(':id/cancel')
  cancel(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: AdminCancelOrderDto) {
    return this.orders.cancelByAdmin(admin.userId, id, dto.reason);
  }
}
