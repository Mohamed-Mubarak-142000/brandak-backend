import { Body, Controller, Get, HttpCode, Module, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AiModule } from '@/ai/ai.module';
import { AnalyticsModule } from '@/analytics/analytics.module';
import { PublicCache } from '@/common/cache';
import { AuthUser, BrandContext, CurrentBrand, CurrentUser, OptionalUser, Public, Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { OrdersModule } from '@/orders/orders.module';
import { UsersModule } from '@/users/users.module';
import { AdminConversationsQueryDto, AssistantMessageDto, AssistantSettingsPatchDto, ConversationsQueryDto, CopilotMessageDto } from './assistant.dto';
import {
  AssistantConversation,
  AssistantConversationSchema,
  AssistantUsage,
  AssistantUsageSchema,
  AssistantVisitorUsage,
  AssistantVisitorUsageSchema,
  CopilotConversation,
  CopilotConversationSchema,
  CopilotUsage,
  CopilotUsageSchema,
} from './assistant.schemas';
import { AssistantService } from './assistant.service';
import { CopilotService } from './copilot.service';

@ApiTags('Assistant')
@Controller('brands/:slug/assistant')
export class PublicAssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /** Whether the store page shows the assistant, its name, greeting and suggested questions. */
  @Public()
  @PublicCache(60)
  @Get()
  info(@Param('slug') slug: string) {
    return this.assistant.publicInfo(slug);
  }

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @HttpCode(200)
  @Post('messages')
  message(@Param('slug') slug: string, @Body() dto: AssistantMessageDto, @OptionalUser() user?: AuthUser) {
    return this.assistant.sendMessage(slug, dto, user);
  }
}

@ApiTags('Assistant')
@ApiBearerAuth()
@UseGuards(BrandMemberGuard)
@Controller('brand/assistant')
export class BrandAssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('settings')
  settings(@CurrentBrand() brand: BrandContext) {
    return this.assistant.getSettings(brand.brandId);
  }

  @Patch('settings')
  update(@CurrentBrand() brand: BrandContext, @Body() dto: AssistantSettingsPatchDto) {
    return this.assistant.updateSettings(brand.brandId, dto);
  }

  @Get('conversations')
  list(@CurrentBrand() brand: BrandContext, @Query() q: ConversationsQueryDto) {
    return this.assistant.listConversations(brand.brandId, q);
  }

  @Get('conversations/:id')
  get(@CurrentBrand() brand: BrandContext, @Param('id', ParseObjectIdPipe) id: string) {
    return this.assistant.getConversation(brand.brandId, id, true);
  }

  @Get('stats')
  stats(@CurrentBrand() brand: BrandContext) {
    return this.assistant.stats(brand.brandId);
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin')
export class AdminAssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('assistant/conversations')
  list(@Query() q: AdminConversationsQueryDto) {
    return this.assistant.listConversations(q.brandId, q, true);
  }

  @Get('assistant/conversations/:id')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.assistant.getConversation(undefined, id, false);
  }

  @Get('brands/:id/assistant')
  settings(@Param('id', ParseObjectIdPipe) id: string) {
    return this.assistant.getSettings(id);
  }

  @Patch('brands/:id/assistant')
  async update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: AssistantSettingsPatchDto) {
    await this.assistant.requireBrand(id);
    return this.assistant.updateSettings(id, dto);
  }
}

@ApiTags('Copilot')
@ApiBearerAuth()
@UseGuards(BrandMemberGuard)
@Controller('brand/copilot')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('messages')
  message(@CurrentUser() user: AuthUser, @CurrentBrand() brand: BrandContext, @Body() dto: CopilotMessageDto) {
    return this.copilot.sendMessage(user.userId, brand.brandId, dto);
  }

  @Get('conversations/:id')
  get(@CurrentUser() user: AuthUser, @CurrentBrand() brand: BrandContext, @Param('id', ParseObjectIdPipe) id: string) {
    return this.copilot.getConversation(user.userId, brand.brandId, id);
  }
}

@Module({
  imports: [
    AiModule,
    AnalyticsModule,
    OrdersModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: AssistantConversation.name, schema: AssistantConversationSchema },
      { name: AssistantUsage.name, schema: AssistantUsageSchema },
      { name: AssistantVisitorUsage.name, schema: AssistantVisitorUsageSchema },
      { name: CopilotConversation.name, schema: CopilotConversationSchema },
      { name: CopilotUsage.name, schema: CopilotUsageSchema },
    ]),
  ],
  controllers: [PublicAssistantController, BrandAssistantController, AdminAssistantController, CopilotController],
  providers: [AssistantService, CopilotService],
  exports: [AssistantService],
})
export class AssistantModule {}
