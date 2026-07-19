import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from "class-validator";
import { CashMovementType, StaffRole } from "@pos/db";
import { AuthUser, CurrentUser, Roles } from "../auth/decorators";
import { ShiftsService } from "./shifts.service";

class OpenShiftDto {
  @IsInt()
  @Min(0)
  openingFloatCents!: number;
}

class CashMovementDto {
  @IsIn([CashMovementType.CASH_IN, CashMovementType.CASH_OUT])
  type!: CashMovementType;

  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}

class CloseShiftDto {
  @IsInt()
  @Min(0)
  countedCashCents!: number;

  @IsOptional()
  @IsBoolean()
  print?: boolean;
}

const SELLING_ROLES = [
  StaffRole.OWNER,
  StaffRole.MANAGER,
  StaffRole.CASHIER,
  StaffRole.WAITER,
] as const;

@Controller()
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Roles(...SELLING_ROLES)
  @Post("outlets/:outletId/shifts")
  open(
    @CurrentUser() user: AuthUser,
    @Param("outletId", ParseUUIDPipe) outletId: string,
    @Body() dto: OpenShiftDto,
  ) {
    return this.shifts.open(user, outletId, dto.openingFloatCents);
  }

  @Roles(...SELLING_ROLES)
  @Get("outlets/:outletId/shifts/current")
  current(
    @CurrentUser() user: AuthUser,
    @Param("outletId", ParseUUIDPipe) outletId: string,
  ) {
    return this.shifts.current(user, outletId);
  }

  @Roles(...SELLING_ROLES)
  @Post("shifts/:id/cash-movements")
  cashMovement(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CashMovementDto,
  ) {
    return this.shifts.cashMovement(user, id, dto);
  }

  @Roles(...SELLING_ROLES)
  @Post("shifts/:id/close")
  close(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CloseShiftDto,
  ) {
    return this.shifts.close(user, id, dto.countedCashCents, dto.print ?? true);
  }

  @Roles(...SELLING_ROLES)
  @Get("shifts/:id/report")
  report(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.shifts.report(user, id);
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Get("outlets/:outletId/shifts")
  list(
    @CurrentUser() user: AuthUser,
    @Param("outletId", ParseUUIDPipe) outletId: string,
  ) {
    return this.shifts.list(user, outletId);
  }
}
