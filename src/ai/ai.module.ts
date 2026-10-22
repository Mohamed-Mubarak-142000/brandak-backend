import { Body, Controller, Get, Module, Post, UseGuards } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsMongoId, IsOptional, ValidateIf } from 'class-validator';
import { AuthUser, BrandContext, CurrentBrand, CurrentUser } from '@/common/decorators';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { AiService, AiUsage, AiUsageSchema } from './ai.service';
import { GeminiProductAi, PRODUCT_AI } from './product-ai.provider';

class DraftDto {
  /** Up to 3 photos (purpose PRODUCT_IMAGE) of the same product; the first is the main one. */
  @ValidateIf((d: DraftDto) => !d.imageFileId)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsMongoId({ each: true })
  imageFileIds?: string[];

  /** Older app versions send one photo. */
  @IsOptional()
  @IsMongoId()
  imageFileId?: string;
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
    return this.ai.draftFromImage(user.userId, brand.brandId, dto.imageFileIds?.length ? dto.imageFileIds : [dto.imageFileId!]);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: AiUsage.name, schema: AiUsageSchema }])],
  controllers: [AiController],
  providers: [AiService, { provide: PRODUCT_AI, useClass: GeminiProductAi }],
})
export class AiModule {}
