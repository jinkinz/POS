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
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from "class-validator";
import { StaffRole } from "@pos/db";
import { AuthUser, CurrentUser, Roles } from "../auth/decorators";
import { ConsignmentService } from "./consignment.service";

class CreateConsignorDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  commissionBps?: number;
}

class UpdateConsignorDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  commissionBps?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class SettlementDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "month must be YYYY-MM" })
  month!: string;
}

@Roles(StaffRole.OWNER, StaffRole.MANAGER)
@Controller("admin/consignment")
export class ConsignmentController {
  constructor(private readonly consignment: ConsignmentService) {}

  @Post("consignors")
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateConsignorDto) {
    return this.consignment.create(user.companyId, dto);
  }

  @Get("consignors")
  list(@CurrentUser() user: AuthUser) {
    return this.consignment.list(user.companyId);
  }

  @Patch("consignors/:id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateConsignorDto,
  ) {
    return this.consignment.update(user.companyId, id, dto);
  }

  @Get("consignors/:id/settlements/preview")
  preview(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("month") month: string,
  ) {
    return this.consignment.preview(user.companyId, id, month ?? "");
  }

  @Post("consignors/:id/settlements")
  generate(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SettlementDto,
  ) {
    return this.consignment.generate(user.companyId, id, dto.month);
  }

  @Get("settlements")
  settlements(@CurrentUser() user: AuthUser) {
    return this.consignment.listSettlements(user.companyId);
  }

  @Post("settlements/:id/paid")
  markPaid(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.consignment.markPaid(user.companyId, id);
  }
}
