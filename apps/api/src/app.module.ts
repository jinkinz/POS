import { Module } from "@nestjs/common";
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
})
export class AppModule {}
