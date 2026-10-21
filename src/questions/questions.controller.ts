import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { AuthUser, BrandContext, CurrentBrand, CurrentUser, OptionalUser, Public, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { PageQueryDto } from '@/common/pagination';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { QuestionsService } from './questions.service';

class AskDto {
  @IsString() @Length(5, 300) text: string;
}
class AnswerDto {
  @IsString() @Length(2, 1000) text: string;
}
class BrandQuestionsQueryDto extends PageQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unanswered?: boolean;
}
class HideDto {
  @IsBoolean() hidden: boolean;
}

@ApiTags('Questions')
@Controller()
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  /** Public; a signed-in viewer also sees their own questions waiting for an answer. */
  @Public()
  @Get('products/:id/questions')
  list(@Param('id', ParseObjectIdPipe) id: string, @Query() query: PageQueryDto, @OptionalUser() user?: AuthUser) {
    return this.questions.listForProduct(id, query, user?.userId);
  }

  @ApiBearerAuth()
  @Post('products/:id/questions')
  ask(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: AskDto) {
    return this.questions.ask(user.userId, id, dto.text);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Get('brand/questions')
  mine(@CurrentBrand() brand: BrandContext, @Query() query: BrandQuestionsQueryDto) {
    return this.questions.listForBrand(brand.brandId, query);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @HttpCode(200)
  @Post('brand/questions/:id/answer')
  answer(@CurrentBrand() brand: BrandContext, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: AnswerDto) {
    return this.questions.answer(brand.brandId, id, dto.text);
  }

  @ApiBearerAuth()
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(200)
  @Post('admin/questions/:id/hidden')
  hide(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: HideDto) {
    return this.questions.setHidden(id, dto.hidden);
  }
}
