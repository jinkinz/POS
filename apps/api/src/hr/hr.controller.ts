import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
} from "class-validator";
import { StaffRole } from "@pos/db";
import { AuthUser, CurrentUser, Roles } from "../auth/decorators";
import { HrService } from "./hr.service";

class ClockDto {
  @IsOptional()
  @IsUUID()
  outletId?: string;
}

class ManualEntryDto {
  @IsUUID()
  staffId!: string;

  @IsUUID()
  outletId!: string;

  @IsISO8601()
  clockIn!: string;

  @IsISO8601()
  clockOut!: string;
}

class RunDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "month must be YYYY-MM" })
  month!: string;
}

@Controller()
export class HrController {
  constructor(private readonly hr: HrService) {}

  // Any staff session can clock (kitchen included).
  @Post("attendance/clock")
  clock(@CurrentUser() user: AuthUser, @Body() dto: ClockDto) {
    return this.hr.clock(user, dto.outletId);
  }

  @Get("attendance/me")
  myStatus(@CurrentUser() user: AuthUser) {
    return this.hr.myStatus(user);
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Get("admin/attendance")
  attendance(@CurrentUser() user: AuthUser, @Query("month") month: string) {
    return this.hr.attendance(user.companyId, month ?? "");
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Post("admin/attendance/entries")
  addEntry(@CurrentUser() user: AuthUser, @Body() dto: ManualEntryDto) {
    return this.hr.addManualEntry(user.companyId, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Delete("admin/attendance/entries/:id")
  deleteEntry(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.hr.deleteEntry(user.companyId, id);
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Post("admin/payroll/runs")
  compute(@CurrentUser() user: AuthUser, @Body() dto: RunDto) {
    return this.hr.computeRun(user.companyId, dto.month);
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Get("admin/payroll/runs")
  listRuns(@CurrentUser() user: AuthUser) {
    return this.hr.listRuns(user.companyId);
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Get("admin/payroll/runs/:id")
  getRun(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.hr.getRun(user.companyId, id);
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Post("admin/payroll/runs/:id/finalize")
  finalize(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.hr.finalize(user.companyId, id);
  }
}
