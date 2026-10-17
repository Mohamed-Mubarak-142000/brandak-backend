import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { OrderPaymentMethod, OrderStatus } from '@/common/enums';
import { PageQueryDto } from '@/common/pagination';

export class QuoteDto {
  @IsMongoId()
  addressId: string;
}

export class PlaceOrderDto extends QuoteDto {
  @IsOptional()
  @IsEnum(OrderPaymentMethod)
  paymentMethod?: OrderPaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /**
   * The grand total the customer saw. If prices changed since, the order is refused with
   * PRICE_CHANGED so the customer can review the new total instead of being surprised.
   */
  @IsOptional()
  @IsNumber()
  expectedTotal?: number;
}

export class UpdateOrderStatusDto {
  @IsIn([OrderStatus.CONFIRMED, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.CANCELLED])
  status: OrderStatus;

  /** Required when cancelling. */
  @IsOptional()
  @IsString()
  @Length(3, 500)
  note?: string;
}

export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AdminCancelOrderDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}

export class OrdersQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

export class BrandOrdersQueryDto extends OrdersQueryDto {
  /** Order number or customer phone. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  q?: string;

  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class AdminOrdersQueryDto extends BrandOrdersQueryDto {
  @IsOptional()
  @IsMongoId()
  brandId?: string;

  /** true = only soft-deleted orders. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  deleted?: boolean;
}
