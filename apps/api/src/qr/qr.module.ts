import { Module } from "@nestjs/common";
import { MenuModule } from "../menu/menu.module";
import { OrdersModule } from "../orders/orders.module";
import { PrismaService } from "../prisma.service";
import { QrController } from "./qr.controller";
import { QrGuard } from "./qr.guard";
import { QrService } from "./qr.service";

@Module({
  imports: [MenuModule, OrdersModule],
  controllers: [QrController],
  providers: [QrService, QrGuard, PrismaService],
})
export class QrModule {}
