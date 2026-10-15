import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { GOVERNORATES } from '@/common/governorates';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';

@ApiTags('Catalog')
@Controller()
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Public()
  @Get('categories')
  list() {
    return this.categories.listActive();
  }

  /** Reference data for address forms and shipping zones. */
  @Public()
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

  @Post()
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }
}
