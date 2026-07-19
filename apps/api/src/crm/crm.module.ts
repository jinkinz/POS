import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RealtimeModule } from "../realtime/realtime.module";
import { CrmController } from "./crm.controller";
import { LoyaltyService } from "./loyalty.service";
import { VouchersService } from "./vouchers.service";

@Module({
  imports: [RealtimeModule],
  controllers: [CrmController],
  providers: [LoyaltyService, VouchersService, PrismaService],
  exports: [LoyaltyService, VouchersService],
})
export class CrmModule {}
