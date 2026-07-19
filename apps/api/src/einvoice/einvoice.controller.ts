import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { Type } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateNested,
} from "class-validator";
import { StaffRole } from "@pos/db";
import { AuthUser, CurrentUser, Roles } from "../auth/decorators";
import { EInvoiceService } from "./einvoice.service";

class ProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  tin?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  brn?: string;

  @IsOptional()
  @IsString()
  sstNo?: string;

  @IsOptional()
  @Matches(/^\d{5}$/, { message: "MSIC code is 5 digits" })
  msicCode?: string;

  @IsOptional()
  @IsString()
  invoiceAddress?: string;
}

class BuyerDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(3)
  tin!: string;

  @IsIn(["NRIC", "BRN", "PASSPORT", "ARMY"])
  idType!: "NRIC" | "BRN" | "PASSPORT" | "ARMY";

  @IsString()
  @MinLength(3)
  idValue!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

class IndividualDto {
  @ValidateNested()
  @Type(() => BuyerDto)
  buyer!: BuyerDto;
}

class ConsolidatedDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "month must be YYYY-MM" })
  month!: string;
}

@Roles(StaffRole.OWNER, StaffRole.MANAGER)
@Controller("admin/einvoice")
export class EInvoiceController {
  constructor(private readonly einvoice: EInvoiceService) {}

  @Get("profile")
  profile(@CurrentUser() user: AuthUser) {
    return this.einvoice.getProfile(user.companyId);
  }

  @Patch("profile")
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: ProfileDto) {
    return this.einvoice.updateProfile(user.companyId, dto);
  }

  @Post("orders/:orderId")
  individual(
    @CurrentUser() user: AuthUser,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() dto: IndividualDto,
  ) {
    return this.einvoice.submitIndividual(user.companyId, orderId, dto.buyer);
  }

  @Get("consolidated/preview")
  preview(@CurrentUser() user: AuthUser, @Query("month") month: string) {
    return this.einvoice.previewConsolidated(user.companyId, month ?? "");
  }

  @Post("consolidated")
  consolidated(@CurrentUser() user: AuthUser, @Body() dto: ConsolidatedDto) {
    return this.einvoice.submitConsolidated(user.companyId, dto.month);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.einvoice.list(user.companyId);
  }

  @Post(":id/refresh")
  refresh(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.einvoice.refresh(user.companyId, id);
  }
}
