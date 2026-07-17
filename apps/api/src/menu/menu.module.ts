import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RealtimeModule } from "../realtime/realtime.module";
import { MenuController } from "./menu.controller";
import { MenuService } from "./menu.service";

@Module({
  imports: [RealtimeModule],
  controllers: [MenuController],
  providers: [MenuService, PrismaService],
  exports: [MenuService],
})
export class MenuModule {}
