import { Module } from "@nestjs/common";
import { PrintingModule } from "../printing/printing.module";
import { PrismaService } from "../prisma.service";
import { ShiftsController } from "./shifts.controller";
import { ShiftsService } from "./shifts.service";

@Module({
  imports: [PrintingModule],
  controllers: [ShiftsController],
  providers: [ShiftsService, PrismaService],
})
export class ShiftsModule {}
