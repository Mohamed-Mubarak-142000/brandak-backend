import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsMongoId, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '@/common/decorators';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { CartsService, MAX_QTY_PER_LINE } from './carts.service';

class AddCartItemDto {
  @IsMongoId()
  productId: string;

  @IsMongoId()
  variantId: string;

  @IsInt()
  @Min(1)
  @Max(MAX_QTY_PER_LINE)
  quantity: number;
}

class UpdateCartItemDto {
  @IsInt()
  @Min(1)
  @Max(MAX_QTY_PER_LINE)
  quantity: number;
}

@ApiTags('Customer')
@ApiBearerAuth()
@Controller('carts')
export class CartsController {
  constructor(private readonly carts: CartsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.carts.listMine(user.userId);
  }

  @Get(':brandId')
  view(@CurrentUser() user: AuthUser, @Param('brandId', ParseObjectIdPipe) brandId: string) {
    return this.carts.view(user.userId, brandId);
  }

  @Post(':brandId/items')
  add(
    @CurrentUser() user: AuthUser,
    @Param('brandId', ParseObjectIdPipe) brandId: string,
    @Body() dto: AddCartItemDto,
  ) {
    return this.carts.addItem(user.userId, brandId, dto.productId, dto.variantId, dto.quantity);
  }

  @Patch(':brandId/items/:itemId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('brandId', ParseObjectIdPipe) brandId: string,
    @Param('itemId', ParseObjectIdPipe) itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.carts.updateItem(user.userId, brandId, itemId, dto.quantity);
  }

  @Delete(':brandId/items/:itemId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('brandId', ParseObjectIdPipe) brandId: string,
    @Param('itemId', ParseObjectIdPipe) itemId: string,
  ) {
    return this.carts.removeItem(user.userId, brandId, itemId);
  }

  @Delete(':brandId')
  @HttpCode(204)
  clear(@CurrentUser() user: AuthUser, @Param('brandId', ParseObjectIdPipe) brandId: string) {
    return this.carts.clear(user.userId, brandId);
  }
}
