import { Controller, Get, Module, Query, UseGuards } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';
import { BrandContext, CurrentBrand, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { OrdersModule } from '@/orders/orders.module';
import { Report, ReportSchema } from '@/reviews/review.schema';
import { UsersModule } from '@/users/users.module';
import { User, UserSchema } from '@/users/user.schema';
import { AnalyticsService, resolveRange } from './analytics.service';

class RangeQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

@ApiTags('Brand dashboard')
@ApiBearerAuth()
@UseGuards(BrandMemberGuard)
@Controller('brand/analytics')
export class BrandAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(@CurrentBrand() brand: BrandContext, @Query() q: RangeQueryDto) {
    return this.analytics.brandOverview(brand.brandId, resolveRange(q.from, q.to));
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(@Query() q: RangeQueryDto) {
    return this.analytics.adminOverview(resolveRange(q.from, q.to));
  }
}

@Module({
  imports: [
    OrdersModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Report.name, schema: ReportSchema },
    ]),
  ],
  controllers: [BrandAnalyticsController, AdminAnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
