import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { IngredientUnit } from "@pos/db";

export class CreateIngredientDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(IngredientUnit)
  unit!: IngredientUnit;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costCents?: number;
}

export class UpdateIngredientDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costCents?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class RecipeLineDto {
  @IsUUID()
  ingredientId!: string;

  @IsNumber()
  @Min(0.001)
  qty!: number;
}

export class SetRecipeDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeLineDto)
  items!: RecipeLineDto[];
}

export class ReceiveStockDto {
  @IsUUID()
  ingredientId!: string;

  @IsNumber()
  @Min(0.001)
  qty!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCostCents?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdjustStockDto {
  @IsUUID()
  ingredientId!: string;

  @IsNumber()
  qtyDelta!: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}

export class WastageDto {
  @IsUUID()
  ingredientId!: string;

  @IsNumber()
  @Min(0.001)
  qty!: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}

export class StocktakeCountDto {
  @IsUUID()
  ingredientId!: string;

  @IsNumber()
  @Min(0)
  countedQty!: number;
}

export class StocktakeDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StocktakeCountDto)
  counts!: StocktakeCountDto[];
}

export class LowThresholdDto {
  @IsUUID()
  ingredientId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  lowThresholdQty?: number;
}

export class RetailMoveDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  qty!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class RetailAdjustDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  qtyDelta!: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}

export class RetailCountDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(0)
  countedQty!: number;
}

export class RetailStocktakeDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RetailCountDto)
  counts!: RetailCountDto[];
}

export class MovementsQueryDto {
  @IsOptional()
  @IsUUID()
  ingredientId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number;
}
