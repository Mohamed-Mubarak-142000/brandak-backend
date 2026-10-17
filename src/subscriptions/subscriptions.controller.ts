import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, BrandContext, CurrentBrand, CurrentUser, Public, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import {
  AdminPaymentsQueryDto,
  AdminSubscriptionsQueryDto,
  ApprovePaymentDto,
  CreatePlanDto,
  RejectPaymentDto,
  RequestSubscriptionDto,
  SubmitPaymentProofDto,
  UpdatePlanDto,
} from './subscriptions.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('Subscriptions')
@Controller()
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Public()
  @Get('subscription-plans')
  plans() {
    return this.subscriptions.listActivePlans();
  }

  @ApiBearerAuth()
  @Get('payment-instructions')
  instructions() {
    return this.subscriptions.instructions();
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Get('brand/subscriptions/me')
  mine(@CurrentBrand() brand: BrandContext) {
    return this.subscriptions.mine(brand.brandId);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Post('brand/subscriptions')
  request(@CurrentUser() user: AuthUser, @CurrentBrand() brand: BrandContext, @Body() dto: RequestSubscriptionDto) {
    return this.subscriptions.request(user.userId, brand.brandId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @HttpCode(200)
  @Post('brand/subscriptions/:id/payment-proofs')
  submitProof(
    @CurrentUser() user: AuthUser,
    @CurrentBrand() brand: BrandContext,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SubmitPaymentProofDto,
  ) {
    return this.subscriptions.submitProof(user.userId, brand.brandId, id, dto);
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin')
export class AdminSubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get('payments')
  payments(@Query() query: AdminPaymentsQueryDto) {
    return this.subscriptions.listPayments(query);
  }

  @Get('payments/:id')
  payment(@Param('id', ParseObjectIdPipe) id: string) {
    return this.subscriptions.getPayment(id);
  }

  @Get('payments/:id/proof-url')
  proofUrl(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.subscriptions.proofUrl(admin.userId, id);
  }

  @HttpCode(200)
  @Post('payments/:id/approve')
  approve(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: ApprovePaymentDto) {
    return this.subscriptions.approve(admin.userId, id, dto.reviewNote);
  }

  @HttpCode(200)
  @Post('payments/:id/reject')
  reject(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: RejectPaymentDto) {
    return this.subscriptions.reject(admin.userId, id, dto.reason);
  }

  @Get('subscriptions')
  list(@Query() query: AdminSubscriptionsQueryDto) {
    return this.subscriptions.listSubscriptions(query);
  }

  @Get('plans')
  plans() {
    return this.subscriptions.listAllPlans();
  }

  @Post('plans')
  createPlan(@Body() dto: CreatePlanDto) {
    return this.subscriptions.createPlan(dto);
  }

  @Patch('plans/:id')
  updatePlan(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdatePlanDto) {
    return this.subscriptions.updatePlan(admin.userId, id, dto);
  }

  @HttpCode(200)
  @Post('plans/:id/delete')
  deletePlan(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.subscriptions.deletePlan(admin.userId, id);
  }

  @HttpCode(200)
  @Post('plans/:id/restore')
  restorePlan(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.subscriptions.restorePlan(admin.userId, id);
  }
}
