import { Body, Controller, Get, HttpCode, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { CategoriesService } from '@/categories/categories.service';
import { AuthUser, BrandContext, CurrentBrand, CurrentUser, Public } from '@/common/decorators';
import { AppError } from '@/common/errors';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { ProductsService } from '../products.service';
import { ProductImportService } from './product-import.service';
import { buildTemplate } from './template';

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const fileUpload = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } });

class CommitImportDto {
  /** Publish what the plan allows (products with photos only); the rest stay drafts. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  publish?: boolean;
}

class ImportImagesDto {
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  urls: string[];

  @IsOptional()
  @IsBoolean()
  publish?: boolean;

  /** Same order as urls: the colour each photo shows ("" = every colour). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  colors?: string[];
}

const requireFile = (file?: Express.Multer.File) => {
  if (!file) throw AppError.unprocessable('FILE_REQUIRED', 'A file is required');
  return file;
};

@ApiTags('Product import')
@Controller()
export class ProductImportController {
  constructor(
    private readonly importer: ProductImportService,
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
  ) {}

  /** Excel template with example rows, a category list and instructions. Public so a browser can download it. */
  @Public()
  @Get('product-import/template.xlsx')
  async template(@Res() res: Response) {
    const all = await this.categories.listActive();
    const names = new Map(all.map((c) => [c._id.toString(), c.nameAr]));
    const file = await buildTemplate(all.map((c) => ({ nameAr: c.nameAr, parent: c.parentId ? names.get(c.parentId.toString()) : undefined })));
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('content-disposition', `attachment; filename="dakakeen-products-template.xlsx"`);
    res.setHeader('cache-control', 'public, max-age=3600');
    res.end(file);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('brand/products/import/preview')
  @UseInterceptors(fileUpload)
  preview(@CurrentBrand() brand: BrandContext, @UploadedFile() file?: Express.Multer.File) {
    const f = requireFile(file);
    return this.importer.preview(brand.brandId, f.buffer, f.originalname);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @ApiConsumes('multipart/form-data')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('brand/products/import')
  @UseInterceptors(fileUpload)
  commit(@CurrentBrand() brand: BrandContext, @Body() dto: CommitImportDto, @UploadedFile() file?: Express.Multer.File) {
    const f = requireFile(file);
    return this.importer.commit(brand.brandId, f.buffer, f.originalname, !!dto.publish);
  }

  @ApiBearerAuth()
  @UseGuards(BrandMemberGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(200)
  @Post('brand/products/:id/import-images')
  importImages(
    @CurrentUser() user: AuthUser,
    @CurrentBrand() brand: BrandContext,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ImportImagesDto,
  ) {
    return this.products.importImages(user.userId, brand.brandId, id, dto.urls, !!dto.publish);
  }
}
