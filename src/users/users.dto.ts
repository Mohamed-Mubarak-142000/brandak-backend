import { IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { AccountStatus } from '@/common/enums';
import { PageQueryDto } from '@/common/pagination';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;
}

export class AdminUsersQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;
}

export class SetUserStatusDto {
  @IsEnum(AccountStatus)
  status: AccountStatus;
}
