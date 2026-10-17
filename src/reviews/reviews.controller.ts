import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { PageQueryDto } from '@/common/pagination';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { ReasonDto } from '@/brands/brands.dto';
import {
  CreateReportDto,
  CreateReviewDto,
  ReportsQueryDto,
  ResolveReportDto,
  SetReviewStatusDto,
} from './reviews.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('Reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get('products/:id/reviews')
  list(@Param('id', ParseObjectIdPipe) id: string, @Query() query: PageQueryDto) {
    return this.reviews.listForProduct(id, query);
  }

  @ApiBearerAuth()
  @Post('products/:id/reviews')
  create(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: CreateReviewDto) {
    return this.reviews.create(user.userId, id, dto);
  }

  @ApiBearerAuth()
  @Get('reviews/me')
  mine(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
    return this.reviews.listMine(user.userId, query);
  }

  /** Report a review, product or brand for moderation. */
  @ApiBearerAuth()
  @Post('reports')
  report(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto) {
    return this.reviews.report(user.userId, dto);
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin')
export class AdminModerationController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('reports')
  reports(@Query() query: ReportsQueryDto) {
    return this.reviews.listReports(query);
  }

  @Patch('reports/:id')
  resolve(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: ResolveReportDto) {
    return this.reviews.resolveReport(admin.userId, id, dto);
  }

  @Patch('reviews/:id')
  setReviewStatus(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: SetReviewStatusDto) {
    return this.reviews.setReviewStatus(admin.userId, id, dto.status);
  }

  @HttpCode(200)
  @Post('reports/:id/delete')
  deleteReport(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.reviews.deleteReport(admin.userId, id);
  }

  @HttpCode(200)
  @Post('reports/:id/restore')
  restoreReport(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.reviews.restoreReport(admin.userId, id);
  }

  @HttpCode(200)
  @Post('reviews/:id/delete')
  deleteReview(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.reviews.setReviewDeleted(admin.userId, id, true);
  }

  @HttpCode(200)
  @Post('reviews/:id/restore')
  restoreReview(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.reviews.setReviewDeleted(admin.userId, id, false);
  }

  @HttpCode(204)
  @Post('products/:id/archive')
  archiveProduct(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: ReasonDto) {
    return this.reviews.archiveProduct(admin.userId, id, dto.reason);
  }
}
