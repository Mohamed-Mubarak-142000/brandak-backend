import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { GOVERNORATE_CODES } from '@/common/governorates';

export class LocationDto {
  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;
}

export class CreateAddressDto {
  @IsOptional() @IsString() @MaxLength(40) label?: string;

  @IsString() @Length(2, 100) recipientName: string;

  @IsString() @MaxLength(20) phone: string;

  @IsIn(GOVERNORATE_CODES)
  governorate: string;

  @IsString() @Length(2, 80) city: string;
  @IsOptional() @IsString() @MaxLength(80) area?: string;
  @IsString() @Length(2, 200) street: string;
  @IsOptional() @IsString() @MaxLength(40) building?: string;
  @IsOptional() @IsString() @MaxLength(20) floor?: string;
  @IsOptional() @IsString() @MaxLength(20) apartment?: string;
  @IsOptional() @IsString() @MaxLength(200) landmark?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
