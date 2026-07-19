import { Module } from "@nestjs/common";
import { CrmModule } from "../crm/crm.module";
import { PrismaService } from "../prisma.service";
import { RealtimeModule } from "../realtime/realtime.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [RealtimeModule, CrmModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PrismaService],
})
export class PaymentsModule {}
