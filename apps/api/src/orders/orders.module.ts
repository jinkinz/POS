import { Module } from "@nestjs/common";
import { CrmModule } from "../crm/crm.module";
import { InventoryModule } from "../inventory/inventory.module";
import { PrintingModule } from "../printing/printing.module";
import { PrismaService } from "../prisma.service";
import { RealtimeModule } from "../realtime/realtime.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [RealtimeModule, InventoryModule, PrintingModule, CrmModule],
  controllers: [OrdersController],
  providers: [OrdersService, PrismaService],
  exports: [OrdersService],
})
export class OrdersModule {}
