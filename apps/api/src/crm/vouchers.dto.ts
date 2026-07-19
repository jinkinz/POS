import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  MinLength,
} from "class-validator";
import { CampaignKind, DiscountType } from "@pos/db";

export class CreateCampaignDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEnum(CampaignKind)
  kind!: CampaignKind;

  @IsOptional()
  @Matches(/^[A-Za-z0-9-]{3,20}$/, { message: "Code: 3-20 letters/digits/dashes" })
  code?: string;

  @IsEnum(DiscountType)
  discountType!: DiscountType;

  @IsOptional()
  @IsInt()
  @Min(1)
  valueCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  valueBps?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxDiscountCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minSpendCents?: number;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;
}

export class IssueVoucherDto {
  @IsUUID()
  memberId!: string;
}

export class ApplyVoucherDto {
  @IsString()
  @MinLength(3)
  code!: string;
}
