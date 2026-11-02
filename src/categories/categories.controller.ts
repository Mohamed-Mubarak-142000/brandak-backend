import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PublicCache } from '@/common/cache';
import { AuthUser, CurrentUser, Public, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { GOVERNORATES } from '@/common/governorates';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { CategoriesService } from './categories.service';
import { CategoriesQueryDto, CreateCategoryDto, UpdateCategoryDto } from './categories.dto';

@ApiTags('Catalog')
@Controller()
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Public()
  @PublicCache(600)
  @Get('categories')
  list(@Query() query: CategoriesQueryDto) {
    return this.categories.listActive(query.storeType);
  }

  /** What a product in this category asks for, as the given kind of store sees it. */
  @Public()
  @PublicCache(600)
  @Get('categories/:id/template')
  template(@Param('id', ParseObjectIdPipe) id: string, @Query() query: CategoriesQueryDto) {
    return this.categories.template(id, query.storeType);
  }

  /** Reference data for address forms and shipping zones. */
  @Public()
  @PublicCache(600)
  @Get('governorates')
  governorates() {
    return GOVERNORATES;
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list() {
    return this.categories.listAll();
  }

  /** Size lists and selling units for the template editor. */
  @Get('presets')
  presets() {
    return this.categories.presets();
  }

  @Post()
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }

  @HttpCode(200)
  @Post(':id/delete')
  softDelete(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.categories.softDelete(admin.userId, id);
  }

  @HttpCode(200)
  @Post(':id/restore')
  restore(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.categories.restore(admin.userId, id);
  }
}
