import { Body, Controller, Get, Global, HttpCode, Module, Param, Post, Query, UseGuards } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { CustomerOnlyGuard } from '@/common/guards/customer-only.guard';
import { PageQueryDto } from '@/common/pagination';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { UsersModule } from '@/users/users.module';
import { Reseller, ResellerEarning, ResellerEarningSchema, ResellerPayout, ResellerPayoutSchema, ResellerSchema } from './reseller.schemas';
import { ResellersService } from './resellers.service';

class JoinDto {
  /** InstaPay address or wallet number for payouts. */
  @IsString() @Length(4, 80) payoutAddress: string;
  @IsString() @Length(2, 80) payoutName: string;
}
class PayoutsQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(['REQUESTED', 'PAID', 'REJECTED']) status?: string;
}
class PaidDto {
  @IsString() @Length(4, 64) reference: string;
}
class RejectDto {
  @IsString() @Length(3, 500) reason: string;
}
class StatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED']) status: 'ACTIVE' | 'SUSPENDED';
}

@ApiTags('Resellers')
@ApiBearerAuth()
@UseGuards(CustomerOnlyGuard)
@Controller('reseller')
export class ResellersController {
  constructor(private readonly resellers: ResellersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.resellers.me(user.userId);
  }

  @HttpCode(200)
  @Post('join')
  join(@CurrentUser() user: AuthUser, @Body() dto: JoinDto) {
    return this.resellers.join(user.userId, dto);
  }

  @Get('earnings')
  earnings(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
    return this.resellers.listEarnings(user.userId, query);
  }

  @Get('payouts')
  payouts(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
    return this.resellers.myPayouts(user.userId, query);
  }

  @Post('payouts')
  requestPayout(@CurrentUser() user: AuthUser) {
    return this.resellers.requestPayout(user.userId);
  }
}

@ApiTags('Resellers')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin/resellers')
export class AdminResellersController {
  constructor(private readonly resellers: ResellersService) {}

  @Get('payouts')
  payouts(@Query() query: PayoutsQueryDto) {
    return this.resellers.listPayouts(query);
  }

  @HttpCode(200)
  @Post('payouts/:id/paid')
  paid(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: PaidDto) {
    return this.resellers.markPaid(user.userId, id, dto.reference);
  }

  @HttpCode(200)
  @Post('payouts/:id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: RejectDto) {
    return this.resellers.reject(user.userId, id, dto.reason);
  }

  @HttpCode(200)
  @Post(':userId/status')
  status(@CurrentUser() user: AuthUser, @Param('userId', ParseObjectIdPipe) userId: string, @Body() dto: StatusDto) {
    return this.resellers.setStatus(user.userId, userId, dto.status);
  }
}

@Global()
@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: Reseller.name, schema: ResellerSchema },
      { name: ResellerEarning.name, schema: ResellerEarningSchema },
      { name: ResellerPayout.name, schema: ResellerPayoutSchema },
    ]),
  ],
  controllers: [ResellersController, AdminResellersController],
  providers: [ResellersService],
  exports: [ResellersService],
})
export class ResellersModule {}
