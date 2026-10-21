import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, BrandContext, CurrentBrand, CurrentUser, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { CreateTicketDto, ResolveTicketDto, TicketMessageDto, TicketsQueryDto } from './support.dto';
import { SupportService } from './support.service';

@ApiTags('Support')
@ApiBearerAuth()
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.support.create(user.userId, dto);
  }

  @Get()
  mine(@CurrentUser() user: AuthUser, @Query() query: TicketsQueryDto) {
    return this.support.listMine(user.userId, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.support.getMine(user.userId, id);
  }

  @Post(':id/messages')
  reply(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: TicketMessageDto) {
    return this.support.customerReply(user.userId, id, dto);
  }

  @HttpCode(200)
  @Post(':id/close')
  close(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.support.close(user.userId, id);
  }
}

@ApiTags('Support')
@ApiBearerAuth()
@UseGuards(BrandMemberGuard)
@Controller('brand/tickets')
export class BrandSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@CurrentBrand() brand: BrandContext, @Query() query: TicketsQueryDto) {
    return this.support.listForBrand(brand.brandId, query);
  }

  @Get(':id')
  get(@CurrentBrand() brand: BrandContext, @Param('id', ParseObjectIdPipe) id: string) {
    return this.support.getForBrand(brand.brandId, id);
  }

  @Post(':id/messages')
  reply(@CurrentBrand() brand: BrandContext, @CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: TicketMessageDto) {
    return this.support.brandReply(brand.brandId, user.userId, id, dto);
  }
}

@ApiTags('Support')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin/tickets')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@Query() query: TicketsQueryDto) {
    return this.support.listAll(query);
  }

  @Get('counts')
  counts() {
    return this.support.counts();
  }

  @Get(':id')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.support.getForAdmin(id);
  }

  @Post(':id/messages')
  reply(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: TicketMessageDto) {
    return this.support.adminReply(user.userId, id, dto);
  }

  @HttpCode(200)
  @Post(':id/resolve')
  resolve(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: ResolveTicketDto) {
    return this.support.resolve(user.userId, id, dto);
  }
}
