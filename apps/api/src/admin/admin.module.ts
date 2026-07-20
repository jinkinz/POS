import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AnalyticsService } from "./analytics.service";

@Module({
  controllers: [AdminController],
  providers: [AdminService, AnalyticsService, PrismaService],
})
export class AdminModule {}
