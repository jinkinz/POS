import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { PrintingModule } from "../printing/printing.module";
import { PrismaService } from "../prisma.service";
import { RealtimeModule } from "../realtime/realtime.module";
import { AggregatorController } from "./aggregator.controller";
import { AggregatorService } from "./aggregator.service";

@Module({
  imports: [RealtimeModule, InventoryModule, PrintingModule],
  controllers: [AggregatorController],
  providers: [AggregatorService, PrismaService],
})
export class AggregatorModule {}
