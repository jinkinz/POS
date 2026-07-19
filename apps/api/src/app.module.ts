import { Module } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { InventoryModule } from "./inventory/inventory.module";
import { HealthController } from "./health.controller";
import { MenuModule } from "./menu/menu.module";
import { OrdersModule } from "./orders/orders.module";
import { PaymentsModule } from "./payments/payments.module";
import { QrModule } from "./qr/qr.module";

@Module({
  imports: [
    AdminModule,
    AuthModule,
    InventoryModule,
    MenuModule,
    OrdersModule,
    PaymentsModule,
    QrModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
