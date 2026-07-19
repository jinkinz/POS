import { Module } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { CrmModule } from "./crm/crm.module";
import { EInvoiceModule } from "./einvoice/einvoice.module";
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
    AuthModule,
    CrmModule,
    EInvoiceModule,
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
