import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { EInvoiceController } from "./einvoice.controller";
import { EInvoiceService } from "./einvoice.service";

@Module({
  controllers: [EInvoiceController],
  providers: [EInvoiceService, PrismaService],
})
export class EInvoiceModule {}
