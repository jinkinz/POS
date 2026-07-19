import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RealtimeModule } from "../realtime/realtime.module";
import { BridgeGuard } from "./bridge.guard";
import { PrintingController } from "./printing.controller";
import { PrintingService } from "./printing.service";

@Module({
  imports: [RealtimeModule],
  controllers: [PrintingController],
  providers: [PrintingService, BridgeGuard, PrismaService],
  exports: [PrintingService],
})
export class PrintingModule {}
