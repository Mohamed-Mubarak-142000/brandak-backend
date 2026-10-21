import { Body, Controller, Delete, Get, Global, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { Model } from 'mongoose';
import { Brand } from '@/brands/brand.schema';
import { AuthUser, CurrentUser, OptionalUser, Public } from '@/common/decorators';
import { PageQueryDto } from '@/common/pagination';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { IMAGE_WIDTH, optimizedImage } from '@/common/utils/image';
import { ProductsService } from '@/products/products.service';
import { UsersModule } from '@/users/users.module';
import { Follow, FollowSchema, Watch, WatchSchema, WatchType } from './alert.schemas';
import { AlertsService } from './alerts.service';

class WatchDto {
  @IsEnum(WatchType) type: WatchType;
  @IsOptional() @IsMongoId() variantId?: string;
}

@ApiTags('Alerts')
@ApiBearerAuth()
@Controller()
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly products: ProductsService,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
  ) {}

  @Post('products/:id/alerts')
  watch(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: WatchDto) {
    return this.alerts.watch(user.userId, id, dto.type, dto.variantId);
  }

  @HttpCode(204)
  @Post('products/:id/alerts/remove')
  async unwatch(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: WatchDto) {
    await this.alerts.unwatch(user.userId, id, dto.type, dto.variantId);
  }

  @Get('products/:id/alerts/me')
  mineFor(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.alerts.mineFor(user.userId, id);
  }

  @Get('alerts/me')
  mine(@CurrentUser() user: AuthUser) {
    return this.alerts.listMine(user.userId);
  }

  /** Followers count, and whether the signed-in viewer follows the store. */
  @Public()
  @Get('brands/:id/follow')
  followState(@Param('id', ParseObjectIdPipe) id: string, @OptionalUser() user?: AuthUser) {
    return this.alerts.followState(id, user?.userId);
  }

  @HttpCode(200)
  @Post('brands/:id/follow')
  follow(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.alerts.follow(user.userId, id);
  }

  @Delete('brands/:id/follow')
  unfollow(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.alerts.unfollow(user.userId, id);
  }

  @Get('following/brands')
  async followedBrands(@CurrentUser() user: AuthUser) {
    const ids = await this.alerts.followedBrandIds(user.userId);
    const rows = await this.brands.find({ _id: { $in: ids }, deletedAt: null }).select('name slug logo ratingAvg ratingCount').lean();
    return rows.map((b) => ({ id: b._id.toString(), name: b.name, slug: b.slug, logoUrl: optimizedImage(b.logo?.url, IMAGE_WIDTH.logo), ratingAvg: b.ratingAvg, ratingCount: b.ratingCount }));
  }

  /** Newest products from the stores the customer follows. */
  @Get('following/products')
  async feed(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
    return this.products.fromBrands(await this.alerts.followedBrandIds(user.userId), query);
  }
}

@Global()
@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: Watch.name, schema: WatchSchema },
      { name: Follow.name, schema: FollowSchema },
    ]),
  ],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
