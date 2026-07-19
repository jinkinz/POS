import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AdminModule } from "./admin/admin.module";
import { AggregatorModule } from "./aggregator/aggregator.module";
import { AuthModule } from "./auth/auth.module";
import { ConsignmentModule } from "./consignment/consignment.module";
import { CrmModule } from "./crm/crm.module";
import { EInvoiceModule } from "./einvoice/einvoice.module";
import { HrModule } from "./hr/hr.module";
import { InventoryModule } from "./inventory/inventory.module";
import { HealthController } from "./health.controller";
import { MenuModule } from "./menu/menu.module";
import { OrdersModule } from "./orders/orders.module";
import { PaymentsModule } from "./payments/payments.module";
import { PrintingModule } from "./printing/printing.module";
import { QrModule } from "./qr/qr.module";
import { ShiftsModule } from "./shifts/shifts.module";

@Module({
  imports: [
    // Global request throttle (per IP); credential endpoints carry a much
    // stricter @Throttle override. Env overrides exist for test runs.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60_000,
          limit: Number(process.env.THROTTLE_GLOBAL_LIMIT ?? 600),
        },
      ],
    }),
    AdminModule,
    AggregatorModule,
    AuthModule,
    ConsignmentModule,
    CrmModule,
    EInvoiceModule,
    HrModule,
    InventoryModule,
    MenuModule,
    OrdersModule,
    PaymentsModule,
    PrintingModule,
    QrModule,
    ShiftsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
