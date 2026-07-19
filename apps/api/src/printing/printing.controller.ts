import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";
import { StaffRole } from "@pos/db";
import { AuthUser, CurrentUser, Public, Roles } from "../auth/decorators";
import { BridgeGuard, BridgeSession, CurrentBridge } from "./bridge.guard";
import { PrintingService } from "./printing.service";

class BridgeSessionDto {
  @IsString()
  @MinLength(32)
  deviceToken!: string;
}

class AckDto {
  @IsBoolean()
  ok!: boolean;

  @IsOptional()
  @IsString()
  error?: string;
}

@Controller()
export class PrintingController {
  constructor(private readonly printing: PrintingService) {}

  // ---- staff side ----

  @Roles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.CASHIER, StaffRole.WAITER)
  @Post("orders/:id/print")
  printReceipt(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) orderId: string,
  ) {
    return this.printing.receiptJob(orderId, user.companyId);
  }

  // ---- bridge side ----

  @Public()
  @Post("bridge/session")
  bridgeSession(@Body() dto: BridgeSessionDto) {
    return this.printing.bridgeSession(dto.deviceToken);
  }

  @Public()
  @UseGuards(BridgeGuard)
  @Get("bridge/jobs")
  pendingJobs(@CurrentBridge() bridge: BridgeSession) {
    return this.printing.pendingJobs(bridge);
  }

  @Public()
  @UseGuards(BridgeGuard)
  @Post("bridge/jobs/:id/ack")
  ack(
    @CurrentBridge() bridge: BridgeSession,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AckDto,
  ) {
    return this.printing.ackJob(bridge, id, dto.ok, dto.error);
  }
}
