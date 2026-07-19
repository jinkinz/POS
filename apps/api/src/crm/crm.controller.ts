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
  IsUUID,
  Matches,
  Min,
  MinLength,
  NotEquals,
} from "class-validator";
import { StaffRole } from "@pos/db";
import { AuthUser, CurrentUser, Roles } from "../auth/decorators";
import { LoyaltyService } from "./loyalty.service";

class CreateMemberDto {
  @Matches(/^\+?[\d\s-]{7,20}$/, { message: "Invalid phone number" })
  phone!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

class UpdateMemberDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class AttachMemberDto {
  @IsUUID()
  memberId!: string;
}

class RedeemDto {
  @IsInt()
  @Min(1)
  points!: number;
}

class AdjustPointsDto {
  @IsInt()
  @NotEquals(0)
  points!: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}

const SELLING_ROLES = [
  StaffRole.OWNER,
  StaffRole.MANAGER,
  StaffRole.CASHIER,
  StaffRole.WAITER,
] as const;

@Controller()
export class CrmController {
  constructor(private readonly loyalty: LoyaltyService) {}

  // ---- POS-facing ----

  @Roles(...SELLING_ROLES)
  @Get("members")
  findByPhone(@CurrentUser() user: AuthUser, @Query("phone") phone?: string) {
    if (!phone) return { member: null };
    return this.loyalty.findByPhone(user.companyId, phone);
  }

  @Roles(...SELLING_ROLES)
  @Post("members")
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMemberDto) {
    return this.loyalty.create(user.companyId, dto);
  }

  @Roles(...SELLING_ROLES)
  @Get("members/:id")
  detail(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.loyalty.detail(user.companyId, id);
  }

  @Roles(...SELLING_ROLES)
  @Post("orders/:id/member")
  attach(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) orderId: string,
    @Body() dto: AttachMemberDto,
  ) {
    return this.loyalty.attachToOrder(user.companyId, orderId, dto.memberId);
  }

  @Roles(...SELLING_ROLES)
  @Post("orders/:id/redeem-points")
  redeem(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) orderId: string,
    @Body() dto: RedeemDto,
  ) {
    return this.loyalty.redeem(user.companyId, orderId, dto.points);
  }

  // ---- back office ----

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Get("admin/members")
  list(@CurrentUser() user: AuthUser, @Query("search") search?: string) {
    return this.loyalty.list(user.companyId, search);
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Patch("admin/members/:id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.loyalty.update(user.companyId, id, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Post("admin/members/:id/points-adjust")
  adjust(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AdjustPointsDto,
  ) {
    return this.loyalty.adjust(user.companyId, id, dto.points, dto.reason);
  }
}
