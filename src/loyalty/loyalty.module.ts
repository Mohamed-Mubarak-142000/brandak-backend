import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '@/common/decorators';
import { PageQueryDto } from '@/common/pagination';
import { LoyaltyService, PointsAccount, PointsAccountSchema, PointsEntry, PointsEntrySchema } from './loyalty.service';

@ApiTags('Points')
@ApiBearerAuth()
@Controller('points/me')
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  /** Balance, what it's worth, and the rules. */
  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.loyalty.summary(user.userId);
  }

  @Get('history')
  history(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
    return this.loyalty.history(user.userId, query);
  }
}

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PointsAccount.name, schema: PointsAccountSchema },
      { name: PointsEntry.name, schema: PointsEntrySchema },
    ]),
  ],
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
