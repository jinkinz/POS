import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RealtimeGateway } from "./realtime.gateway";

@Module({
  providers: [RealtimeGateway, PrismaService],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
