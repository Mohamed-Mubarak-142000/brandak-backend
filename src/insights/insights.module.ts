import { Controller, Get, Global, Module, Query, UseGuards } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Types } from 'mongoose';
import { BrandContext, CurrentBrand, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { OrdersModule } from '@/orders/orders.module';
import { UsersModule } from '@/users/users.module';
import { InsightsService, SearchHit, SearchHitSchema, SearchStat, SearchStatSchema, WeeklyReport, WeeklyReportSchema } from './insights.service';

class DaysDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days?: number;
}

@ApiTags('Insights')
@ApiBearerAuth()
@Controller()
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /** For the store: searches that found it, and what people look for but don't find. */
  @UseGuards(BrandMemberGuard)
  @Get('brand/insights/searches')
  brand(@CurrentBrand() brand: BrandContext, @Query() q: DaysDto) {
    return this.insights.brandInsights(brand.brandId, q.days ?? 30);
  }

  /** The store's last 7 days (same numbers as the weekly email). */
  @UseGuards(BrandMemberGuard)
  @Get('brand/insights/week')
  week(@CurrentBrand() brand: BrandContext) {
    return this.insights.weekSummary(new Types.ObjectId(brand.brandId));
  }

  @Roles(Role.SUPER_ADMIN)
  @Get('admin/insights/searches')
  admin(@Query() q: DaysDto) {
    return this.insights.missing(q.days ?? 30, 50);
  }
}

@Global()
@Module({
  imports: [
    UsersModule,
    OrdersModule,
    MongooseModule.forFeature([
      { name: SearchStat.name, schema: SearchStatSchema },
      { name: SearchHit.name, schema: SearchHitSchema },
      { name: WeeklyReport.name, schema: WeeklyReportSchema },
    ]),
  ],
  controllers: [InsightsController],
  providers: [InsightsService],
  exports: [InsightsService],
})
export class InsightsModule {}
