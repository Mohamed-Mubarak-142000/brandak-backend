import { ArrayMaxSize, IsArray, IsEnum, IsMongoId, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';
import { PageQueryDto } from '@/common/pagination';
import { TicketOutcome, TicketStatus, TicketType } from './ticket.schema';

export class CreateTicketDto {
  @IsEnum(TicketType) type: TicketType;
  @IsOptional() @IsMongoId() orderId?: string;
  @IsString() @Length(3, 120) subject: string;
  @IsString() @Length(5, 2000) text: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsMongoId({ each: true })
  imageFileIds?: string[];
}

export class TicketMessageDto {
  @IsString() @Length(1, 2000) text: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsMongoId({ each: true })
  imageFileIds?: string[];
}

export class TicketsQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;

  /** Only open tickets (waiting store, open, escalated). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  active?: boolean;
}

export class ResolveTicketDto {
  @IsEnum(TicketOutcome) outcome: TicketOutcome;
  @IsString() @MaxLength(1000) note: string;
}
