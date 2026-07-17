import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { OrderSource, OrderType, PaymentMethod } from "@pos/db";

export class OrderItemInputDto {
  /** Client-generated UUID for offline idempotency; server generates when absent. */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  modifierIds?: string[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  courseNo?: number;
}

export class CreateOrderDto {
  /** Client-generated UUID for offline idempotency; server generates when absent. */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsUUID()
  outletId!: string;

  @IsEnum(OrderType)
  type!: OrderType;

  @IsEnum(OrderSource)
  source!: OrderSource;

  @IsOptional()
  @IsUUID()
  tableId?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  guestCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];
}

export class AddItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];
}

export class ItemsStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  itemIds!: string[];

  @IsIn(["PENDING", "PREPARING", "READY", "SERVED"])
  status!: "PENDING" | "PREPARING" | "READY" | "SERVED";
}

export class VoidDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class PayDto {
  /** Client-generated UUID for offline idempotency; server generates when absent. */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  /** For non-cash split tender: how much to charge. Defaults to the remaining balance. */
  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number;

  /** For cash: notes/coins handed over. Defaults to exact rounded remaining balance. */
  @IsOptional()
  @IsInt()
  @Min(1)
  tenderedCents?: number;

  @IsOptional()
  @IsString()
  gatewayRef?: string;
}
