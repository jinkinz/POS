import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CashMovementType, PaymentMethod, PaymentStatus } from "@pos/db";
import { AuthUser } from "../auth/decorators";
import { PrintingService } from "../printing/printing.service";
import { PrismaService } from "../prisma.service";

export interface ShiftReport {
  shiftId: string;
  kind: "X" | "Z";
  outletName: string;
  staffName: string;
  openedAt: Date;
  closedAt: Date | null;
  currency: "MYR" | "SGD";
  payments: { method: string; amountCents: number; count: number }[];
  completedOrders: number;
  salesCents: number;
  voidedOrders: number;
  cash: {
    openingFloatCents: number;
    cashSalesCents: number;
    cashInCents: number;
    cashOutCents: number;
    expectedCents: number;
    countedCents: number | null;
    varianceCents: number | null;
  };
  movements: { type: string; amountCents: number; reason: string; at: Date }[];
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly printing: PrintingService,
  ) {}

  /** One open shift (drawer) per outlet at a time. */
  async open(user: AuthUser, outletId: string, openingFloatCents: number) {
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: outletId, companyId: user.companyId },
    });
    if (!outlet) throw new NotFoundException("Outlet not found");
    const existing = await this.prisma.shift.findFirst({
      where: { outletId, closedAt: null },
    });
    if (existing) {
      throw new ConflictException("A shift is already open for this outlet");
    }
    return this.prisma.shift.create({
      data: { outletId, staffId: user.staffId, openingFloatCents },
    });
  }

  /** The open shift plus a live X-report; { shift: null } when none. */
  async current(user: AuthUser, outletId: string) {
    const shift = await this.prisma.shift.findFirst({
      where: { outletId, closedAt: null, outlet: { companyId: user.companyId } },
    });
    if (!shift) return { shift: null, report: null };
    return { shift, report: await this.buildReport(shift.id) };
  }

  async cashMovement(
    user: AuthUser,
    shiftId: string,
    dto: { type: CashMovementType; amountCents: number; reason: string },
  ) {
    const shift = await this.mustOwnShift(user.companyId, shiftId);
    if (shift.closedAt) throw new ConflictException("Shift is closed");
    await this.prisma.cashMovement.create({
      data: {
        shiftId,
        type: dto.type,
        amountCents: dto.amountCents,
        reason: dto.reason,
      },
    });
    return this.buildReport(shiftId);
  }

  async close(
    user: AuthUser,
    shiftId: string,
    countedCashCents: number,
    print: boolean,
  ) {
    const shift = await this.mustOwnShift(user.companyId, shiftId);
    if (shift.closedAt) throw new ConflictException("Shift is already closed");

    const closedAt = new Date();
    const draft = await this.buildReport(shiftId, closedAt);
    const varianceCents = countedCashCents - draft.cash.expectedCents;

    await this.prisma.shift.update({
      where: { id: shiftId },
      data: {
        closedAt,
        expectedCashCents: draft.cash.expectedCents,
        countedCashCents,
      },
    });

    const report: ShiftReport = {
      ...draft,
      kind: "Z",
      closedAt,
      cash: { ...draft.cash, countedCents: countedCashCents, varianceCents },
    };
    if (print) {
      await this.printing.zReportJob(user.companyId, shift.outletId, report);
    }
    return report;
  }

  async report(user: AuthUser, shiftId: string) {
    await this.mustOwnShift(user.companyId, shiftId);
    return this.buildReport(shiftId);
  }

  async list(user: AuthUser, outletId: string) {
    const shifts = await this.prisma.shift.findMany({
      where: { outletId, outlet: { companyId: user.companyId } },
      orderBy: { openedAt: "desc" },
      take: 30,
      include: { staff: { select: { name: true } } },
    });
    return shifts.map((s) => ({
      id: s.id,
      staffName: s.staff.name,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      openingFloatCents: s.openingFloatCents,
      expectedCashCents: s.expectedCashCents,
      countedCashCents: s.countedCashCents,
      varianceCents:
        s.expectedCashCents != null && s.countedCashCents != null
          ? s.countedCashCents - s.expectedCashCents
          : null,
    }));
  }

  // ---------- internals ----------

  private async mustOwnShift(companyId: string, shiftId: string) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, outlet: { companyId } },
    });
    if (!shift) throw new NotFoundException("Shift not found");
    return shift;
  }

  /** Sales/cash summary for the shift window (openedAt .. closedAt|now). */
  private async buildReport(shiftId: string, windowEnd?: Date): Promise<ShiftReport> {
    const shift = await this.prisma.shift.findUniqueOrThrow({
      where: { id: shiftId },
      include: {
        staff: { select: { name: true } },
        outlet: { include: { company: true } },
        cashMovements: { orderBy: { createdAt: "asc" } },
      },
    });
    const end = shift.closedAt ?? windowEnd ?? new Date();

    const payments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.CAPTURED,
        paidAt: { gte: shift.openedAt, lt: end },
        order: { outletId: shift.outletId },
      },
    });
    const byMethod = new Map<string, { amountCents: number; count: number }>();
    for (const p of payments) {
      const row = byMethod.get(p.method) ?? { amountCents: 0, count: 0 };
      row.amountCents += p.amountCents;
      row.count += 1;
      byMethod.set(p.method, row);
    }
    const cashSalesCents = byMethod.get(PaymentMethod.CASH)?.amountCents ?? 0;

    const [completed, voided] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          outletId: shift.outletId,
          status: "COMPLETED",
          closedAt: { gte: shift.openedAt, lt: end },
        },
        select: { totalCents: true, roundingCents: true },
      }),
      this.prisma.order.count({
        where: {
          outletId: shift.outletId,
          status: "VOIDED",
          closedAt: { gte: shift.openedAt, lt: end },
        },
      }),
    ]);

    const cashInCents = shift.cashMovements
      .filter((m) => m.type === CashMovementType.CASH_IN)
      .reduce((s, m) => s + m.amountCents, 0);
    const cashOutCents = shift.cashMovements
      .filter((m) => m.type === CashMovementType.CASH_OUT)
      .reduce((s, m) => s + m.amountCents, 0);
    const expectedCents =
      shift.openingFloatCents + cashSalesCents + cashInCents - cashOutCents;

    return {
      shiftId: shift.id,
      kind: shift.closedAt ? "Z" : "X",
      outletName: shift.outlet.name,
      staffName: shift.staff.name,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      currency: shift.outlet.company.currency,
      payments: [...byMethod.entries()]
        .map(([method, v]) => ({ method, ...v }))
        .sort((a, b) => b.amountCents - a.amountCents),
      completedOrders: completed.length,
      salesCents: completed.reduce((s, o) => s + o.totalCents + o.roundingCents, 0),
      voidedOrders: voided,
      cash: {
        openingFloatCents: shift.openingFloatCents,
        cashSalesCents,
        cashInCents,
        cashOutCents,
        expectedCents,
        countedCents: shift.countedCashCents,
        varianceCents:
          shift.countedCashCents != null && shift.expectedCashCents != null
            ? shift.countedCashCents - shift.expectedCashCents
            : null,
      },
      movements: shift.cashMovements.map((m) => ({
        type: m.type,
        amountCents: m.amountCents,
        reason: m.reason,
        at: m.createdAt,
      })),
    };
  }
}
