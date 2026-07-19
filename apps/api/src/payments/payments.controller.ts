import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { IsIn, IsOptional } from "class-validator";
import { StaffRole } from "@pos/db";
import { AuthUser, CurrentUser, Public, Roles } from "../auth/decorators";
import { PaymentsService } from "./payments.service";

class CreateGatewayPaymentDto {
  @IsOptional()
  @IsIn(["MOCK", "HITPAY", "FIUU"])
  provider?: string;
}

const SELLING_ROLES = [
  StaffRole.OWNER,
  StaffRole.MANAGER,
  StaffRole.CASHIER,
  StaffRole.WAITER,
] as const;

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get("payments/providers")
  providers() {
    return this.payments.providers();
  }

  @Roles(...SELLING_ROLES)
  @Post("orders/:id/gateway-payments")
  create(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) orderId: string,
    @Body() dto: CreateGatewayPaymentDto,
  ) {
    return this.payments.create(orderId, user.companyId, dto.provider);
  }

  @Roles(...SELLING_ROLES)
  @Get("orders/:id/gateway-payments/:gpId")
  get(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) orderId: string,
    @Param("gpId", ParseUUIDPipe) gpId: string,
  ) {
    return this.payments.get(orderId, gpId, user.companyId);
  }

  @Roles(...SELLING_ROLES)
  @Post("orders/:id/gateway-payments/:gpId/cancel")
  cancel(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) orderId: string,
    @Param("gpId", ParseUUIDPipe) gpId: string,
  ) {
    return this.payments.cancel(orderId, gpId, user.companyId);
  }

  // Gateways call this; adapters authenticate via signature/secret.
  @Public()
  @Post("webhooks/:provider")
  webhook(
    @Param("provider") provider: string,
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.payments.handleWebhook(provider, body ?? {}, headers);
  }
}
