import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '@/common/decorators';
import { Role } from '@/common/enums';
import { PageQueryDto } from '@/common/pagination';
import { AuditLogsService } from './audit-logs.service';

class AuditLogsQueryDto extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(40) entityType?: string;
  @IsOptional() @IsMongoId() entityId?: string;
  @IsOptional() @IsString() @MaxLength(60) action?: string;
}

@ApiTags('Admin')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly logs: AuditLogsService) {}

  @Get()
  list(@Query() query: AuditLogsQueryDto) {
    return this.logs.list(query);
  }
}
