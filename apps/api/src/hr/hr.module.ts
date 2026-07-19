import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { HrController } from "./hr.controller";
import { HrService } from "./hr.service";

@Module({
  controllers: [HrController],
  providers: [HrService, PrismaService],
})
export class HrModule {}
