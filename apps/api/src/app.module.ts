import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { HealthController } from "./health.controller";
import { MenuModule } from "./menu/menu.module";
import { OrdersModule } from "./orders/orders.module";
import { QrModule } from "./qr/qr.module";

@Module({
  imports: [AuthModule, MenuModule, OrdersModule, QrModule],
  controllers: [HealthController],
})
export class AppModule {}
