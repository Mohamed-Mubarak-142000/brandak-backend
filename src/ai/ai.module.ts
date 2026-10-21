import { Body, Controller, Get, Module, Post, UseGuards } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { AuthUser, BrandContext, CurrentBrand, CurrentUser } from '@/common/decorators';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { AiService, AiUsage, AiUsageSchema } from './ai.service';
import { GeminiProductAi, PRODUCT_AI } from './product-ai.provider';

class DraftDto {
  /** A photo uploaded with purpose PRODUCT_IMAGE. */
  @IsMongoId() imageFileId: string;
}

@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(BrandMemberGuard)
@Controller('brand/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** Whether "product from a photo" is on, and how many drafts are left today. */
  @Get('status')
  status(@CurrentBrand() brand: BrandContext) {
    return this.ai.status(brand.brandId);
  }

  @Post('product-draft')
  draft(@CurrentUser() user: AuthUser, @CurrentBrand() brand: BrandContext, @Body() dto: DraftDto) {
    return this.ai.draftFromImage(user.userId, brand.brandId, dto.imageFileId);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: AiUsage.name, schema: AiUsageSchema }])],
  controllers: [AiController],
  providers: [AiService, { provide: PRODUCT_AI, useClass: GeminiProductAi }],
})
export class AiModule {}
