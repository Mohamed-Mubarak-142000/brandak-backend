import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import { CustomerOnlyGuard } from '@/common/guards/customer-only.guard';
import { PageQueryDto } from '@/common/pagination';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { CheckoutService } from './checkout.service';
import {
  AdminCancelOrderDto,
  AdminOrdersQueryDto,
  BrandOrdersQueryDto,
  BlockCustomerDto,
  CancelOrderDto,
  ConfirmOrdersDto,
  OrdersQueryDto,
  PlaceOrderDto,
  QuoteDto,
  ShipmentDto,
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
  @UseGuards(CustomerOnlyGuard)
  @Post('checkout/:brandId/quote')
  quote(@CurrentUser() user: AuthUser, @Param('brandId', ParseObjectIdPipe) brandId: string, @Body() dto: QuoteDto) {
    return this.checkout.quote(user.userId, brandId, dto);
  }

  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Unique per checkout attempt (e.g. a UUID)' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(CustomerOnlyGuard)
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

  /** Confirms every order waiting for the customer's email code. */
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('orders/me/confirm')
  confirm(@CurrentUser() user: AuthUser, @Body() dto: ConfirmOrdersDto) {
    return this.orders.confirmPending(user.userId, dto.code);
  }

  @HttpCode(204)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('orders/me/confirm/resend')
  resend(@CurrentUser() user: AuthUser) {
    return this.orders.resendConfirmation(user.userId);
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
    return this.orders.updateByBrand(user.userId, brand.brandId, id, dto.status, dto.note, dto.shipment);
  }

  @Patch('orders/:id/shipment')
  shipment(@CurrentBrand() brand: BrandContext, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: ShipmentDto) {
    return this.orders.setShipment(brand.brandId, id, dto);
  }

  @Get('customers')
  customers(@CurrentBrand() brand: BrandContext, @Query() query: PageQueryDto) {
    return this.orders.brandCustomers(brand.brandId, query);
  }

  /** Stop selling to the customer behind this order. */
  @Post('orders/:id/block-customer')
  block(
    @CurrentUser() user: AuthUser,
    @CurrentBrand() brand: BrandContext,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: BlockCustomerDto,
  ) {
    return this.orders.blockCustomer(user.userId, brand.brandId, id, dto.note);
  }

  @Get('blocks')
  blocks(@CurrentBrand() brand: BrandContext) {
    return this.orders.listBlocks(brand.brandId);
  }

  @Delete('blocks/:id')
  @HttpCode(204)
  unblock(@CurrentBrand() brand: BrandContext, @Param('id', ParseObjectIdPipe) id: string) {
    return this.orders.unblock(brand.brandId, id);
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

  /** Delivered or cancelled orders only. Reversible with /restore. */
  @HttpCode(200)
  @Post(':id/delete')
  softDelete(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.orders.softDelete(admin.userId, id);
  }

  @HttpCode(200)
  @Post(':id/restore')
  restore(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.orders.restore(admin.userId, id);
  }
}
