import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class AggregatorItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  /** Platform's unit price in cents (usually tax-inclusive platform pricing). */
  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;
}

export class AggregatorOrderDto {
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  provider!: string; // GRABFOOD | FOODPANDA | SHOPEEFOOD | MOCK ...

  @IsString()
  @MinLength(3)
  @MaxLength(64)
  externalRef!: string;

  @IsIn(["DELIVERY", "PICKUP"])
  orderType!: "DELIVERY" | "PICKUP";

  @IsOptional()
  @IsString()
  @MaxLength(60)
  customerName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  totalCents?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AggregatorItemDto)
  items!: AggregatorItemDto[];
}

export class AggregatorCancelDto {
  @IsString()
  @MinLength(2)
  provider!: string;

  @IsString()
  @MinLength(3)
  externalRef!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
