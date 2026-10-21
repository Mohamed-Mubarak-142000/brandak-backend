import { Type } from 'class-transformer';
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
  Matches,
  MaxLength,
  IsUrl,
  ValidateIf,
  ValidateNested,
  ArrayMaxSize,
  IsArray,
  Max,
  Min,
} from 'class-validator';
import { OrderPaymentMethod, OrderStatus } from '@/common/enums';
import { PageQueryDto } from '@/common/pagination';

export class ResalePriceDto {
  @IsMongoId() variantId: string;

  /** The reseller's selling price per piece (at least the store's price). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  price: number;
}

/** A reseller ordering for their own customer, at their own prices. */
export class ResaleDto {
  @IsString() @Length(2, 80) customerName: string;
  @IsString() @Length(8, 20) customerPhone: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ResalePriceDto)
  prices: ResalePriceDto[];
}

export class GiftDto {
  /** Printed on the gift card. */
  @IsOptional() @IsString() @MaxLength(300) message?: string;
  /** Leave prices off the parcel (no priced invoice inside). */
  @IsOptional() @IsBoolean() hidePrices?: boolean;
}

export class QuoteDto {
  /** Spend Fatrina points on this order (as many as allowed). */
  @IsOptional()
  @IsBoolean()
  usePoints?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ResaleDto)
  resale?: ResaleDto;

  /** PICKUP collects the order from the store (when it offers pickup); no address needed. */
  @IsOptional()
  @IsIn(['DELIVERY', 'PICKUP'])
  fulfillment?: 'DELIVERY' | 'PICKUP';

  @ValidateIf((o: QuoteDto) => o.fulfillment !== 'PICKUP')
  @IsMongoId()
  addressId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  couponCode?: string;
}

export class ShipmentDto {
  @IsString()
  @Length(2, 40)
  carrier: string;

  @IsString()
  @Length(3, 60)
  trackingNumber: string;

  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(500)
  trackingUrl?: string;
}

export class PlaceOrderDto extends QuoteDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => GiftDto)
  gift?: GiftDto;

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
  @IsIn([OrderStatus.CONFIRMED, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REFUSED])
  status: OrderStatus;

  /** Required when cancelling. */
  @IsOptional()
  @IsString()
  @Length(3, 500)
  note?: string;

  /** Optional tracking details when marking the order as shipped. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ShipmentDto)
  shipment?: ShipmentDto;
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

export class ConfirmOrdersDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}

export class BlockCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
