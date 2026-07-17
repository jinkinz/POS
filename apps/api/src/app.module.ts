import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { MenuModule } from "./menu/menu.module";
import { OrdersModule } from "./orders/orders.module";

@Module({
  imports: [MenuModule, OrdersModule],
  controllers: [HealthController],
})
export class AppModule {}
