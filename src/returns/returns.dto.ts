import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsMongoId, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { PageQueryDto } from '@/common/pagination';
import { ReturnReason, ReturnStatus } from './return.schema';

export class ReturnItemDto {
  @IsMongoId() variantId: string;
  @IsInt() @Min(1) quantity: number;
}

export class CreateReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];

  @IsEnum(ReturnReason) reason: ReturnReason;

  @IsOptional() @IsString() @MaxLength(1000) note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsMongoId({ each: true })
  imageFileIds?: string[];
}

export class ReturnsQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(ReturnStatus) status?: ReturnStatus;
}

export class ReturnNoteDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RejectReturnDto {
  @IsString() @MaxLength(500) note: string;
}
