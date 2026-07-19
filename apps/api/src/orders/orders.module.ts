import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { PrintingModule } from "../printing/printing.module";
import { PrismaService } from "../prisma.service";
import { RealtimeModule } from "../realtime/realtime.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [RealtimeModule, InventoryModule, PrintingModule],
  controllers: [OrdersController],
  providers: [OrdersService, PrismaService],
  exports: [OrdersService],
})
export class OrdersModule {}
