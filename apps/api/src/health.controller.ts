import { Controller, Get } from "@nestjs/common";
import { computeOrderTotals } from "@pos/shared";
import { Public } from "./auth/decorators";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  health() {
    // Exercise the shared package so a broken workspace link fails loudly here.
    const smoke = computeOrderTotals([{ unitPriceCents: 100, quantity: 1 }], {
      serviceChargeBps: 0,
      taxBps: 0,
      taxInclusive: false,
      serviceChargeTaxable: true,
      cashRounding: "NONE",
    });
    return { status: "ok", smokeTotalCents: smoke.totalCents, ts: new Date().toISOString() };
  }
}
