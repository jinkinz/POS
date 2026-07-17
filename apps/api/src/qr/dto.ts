import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { OrderItemInputDto } from "../orders/dto";

export class QrSessionDto {
  @IsString()
  @MinLength(10)
  qrToken!: string;
}

export class QrOrderDto {
  /** Client-generated UUID so a flaky-connection retry can't double-order. */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  guestName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  guestCount?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];
}
