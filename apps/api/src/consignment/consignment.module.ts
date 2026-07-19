import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { ConsignmentController } from "./consignment.controller";
import { ConsignmentService } from "./consignment.service";

@Module({
  controllers: [ConsignmentController],
  providers: [ConsignmentService, PrismaService],
})
export class ConsignmentModule {}
