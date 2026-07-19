import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MinLength,
} from "class-validator";
import { CashRounding, SalaryType, StaffRole } from "@pos/db";

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsInt()
  @Min(0)
  basePriceCents!: number;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  kitchenStation?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  basePriceCents?: number;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  kitchenStation?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  soldOut?: boolean;
}

export class CreateModifierGroupDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsInt()
  @Min(0)
  minSelect!: number;

  @IsInt()
  @Min(1)
  maxSelect!: number;
}

export class UpdateModifierGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  minSelect?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxSelect?: number;
}

export class CreateModifierDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsInt()
  priceDeltaCents!: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateModifierDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  priceDeltaCents?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  soldOut?: boolean;
}

export class AttachGroupDto {
  @IsUUID()
  groupId!: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateTableDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  zone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  seats?: number;
}

export class UpdateTableDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  zone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  seats?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsEnum(SalaryType)
  salaryType?: SalaryType;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlySalaryCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  hourlyRateCents?: number;

  @IsOptional()
  @Matches(/^\d{4,6}$/, { message: "PIN must be 4-6 digits" })
  pin?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  loyaltyEarnPerCurrencyUnit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  loyaltyRedeemCentsPerPoint?: number;
}

export class UpdateOutletDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3000)
  serviceChargeBps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3000)
  taxBps?: number;

  @IsOptional()
  @IsBoolean()
  taxInclusive?: boolean;

  @IsOptional()
  @IsBoolean()
  serviceChargeTaxable?: boolean;

  @IsOptional()
  @IsEnum(CashRounding)
  cashRounding?: CashRounding;
}
