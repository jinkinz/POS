import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PayrollStatus, SalaryType } from "@pos/db";
import { AuthUser } from "../auth/decorators";
import { PrismaService } from "../prisma.service";

/**
 * Malaysian statutory contributions — SIMPLIFIED percentage model:
 *   EPF: employee 11%; employer 13% (wages <= RM5,000) else 12%
 *   SOCSO: employee 0.5%, employer 1.75%, wage ceiling RM6,000
 *   EIS: 0.2% each side, wage ceiling RM6,000
 *   PCB: 0 (monthly tax deduction needs LHDN schedule tables)
 * The official schedules use wage brackets with rounded amounts; replace
 * these formulas with table lookups before running real payroll.
 */
function statutory(grossCents: number) {
  const epfEmployee = Math.round(grossCents * 0.11);
  const epfEmployer = Math.round(grossCents * (grossCents <= 500000 ? 0.13 : 0.12));
  const capped = Math.min(grossCents, 600000);
  const socsoEmployee = Math.round(capped * 0.005);
  const socsoEmployer = Math.round(capped * 0.0175);
  const eisEmployee = Math.round(capped * 0.002);
  const eisEmployer = Math.round(capped * 0.002);
  return { epfEmployee, epfEmployer, socsoEmployee, socsoEmployer, eisEmployee, eisEmployer };
}

/** "YYYY-MM" -> [start, end) at fixed UTC+8 (MY/SG have no DST). */
function monthWindow(month: string): { start: Date; end: Date } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new BadRequestException("month must be YYYY-MM");
  }
  const [y, m] = month.split("-").map(Number) as [number, number];
  const start = new Date(`${month}-01T00:00:00+08:00`);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start, end: new Date(`${next}-01T00:00:00+08:00`) };
}

@Injectable()
export class HrService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- attendance ----------

  /** Toggle clock: closes the open entry, or opens a new one. */
  async clock(user: AuthUser, outletId?: string) {
    const where = outletId ?? user.outletId;
    if (!where) throw new BadRequestException("outletId required for back-office clock");
    const open = await this.prisma.timeEntry.findFirst({
      where: { staffId: user.staffId, clockOut: null },
      orderBy: { clockIn: "desc" },
    });
    if (open) {
      const entry = await this.prisma.timeEntry.update({
        where: { id: open.id },
        data: { clockOut: new Date() },
      });
      return { status: "OUT" as const, entry };
    }
    const entry = await this.prisma.timeEntry.create({
      data: { staffId: user.staffId, outletId: where, clockIn: new Date() },
    });
    return { status: "IN" as const, entry };
  }

  async myStatus(user: AuthUser) {
    const open = await this.prisma.timeEntry.findFirst({
      where: { staffId: user.staffId, clockOut: null },
      orderBy: { clockIn: "desc" },
    });
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const today = await this.prisma.timeEntry.findMany({
      where: { staffId: user.staffId, clockIn: { gte: dayStart } },
    });
    const workedMs = today.reduce(
      (s, e) => s + ((e.clockOut ?? new Date()).getTime() - e.clockIn.getTime()),
      0,
    );
    return {
      clockedIn: !!open,
      since: open?.clockIn ?? null,
      todayHours: Math.round((workedMs / 3_600_000) * 100) / 100,
    };
  }

  /** Manager view: entries + total hours per staff for a month. */
  async attendance(companyId: string, month: string) {
    const { start, end } = monthWindow(month);
    const staff = await this.prisma.staff.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        role: true,
        salaryType: true,
        timeEntries: {
          where: { clockIn: { gte: start, lt: end } },
          orderBy: { clockIn: "asc" },
        },
      },
    });
    return staff
      .map((s) => ({
        staffId: s.id,
        name: s.name,
        role: s.role,
        salaryType: s.salaryType,
        entries: s.timeEntries.map((e) => ({
          id: e.id,
          clockIn: e.clockIn,
          clockOut: e.clockOut,
          manual: e.manual,
        })),
        totalHours: round2(
          s.timeEntries.reduce(
            (sum, e) =>
              e.clockOut
                ? sum + (e.clockOut.getTime() - e.clockIn.getTime()) / 3_600_000
                : sum,
            0,
          ),
        ),
      }))
      .filter((s) => s.entries.length > 0 || s.salaryType != null);
  }

  /** Manager correction / manual entry. */
  async addManualEntry(
    companyId: string,
    dto: { staffId: string; outletId: string; clockIn: string; clockOut: string },
  ) {
    const staff = await this.prisma.staff.findFirst({
      where: { id: dto.staffId, companyId },
    });
    if (!staff) throw new NotFoundException("Staff not found");
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: dto.outletId, companyId },
    });
    if (!outlet) throw new NotFoundException("Outlet not found");
    const clockIn = new Date(dto.clockIn);
    const clockOut = new Date(dto.clockOut);
    if (!(clockOut > clockIn)) {
      throw new BadRequestException("clockOut must be after clockIn");
    }
    return this.prisma.timeEntry.create({
      data: { staffId: dto.staffId, outletId: dto.outletId, clockIn, clockOut, manual: true },
    });
  }

  async deleteEntry(companyId: string, entryId: string) {
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, staff: { companyId } },
    });
    if (!entry) throw new NotFoundException("Entry not found");
    await this.prisma.timeEntry.delete({ where: { id: entryId } });
    return { ok: true };
  }

  // ---------- payroll ----------

  /** Compute (or recompute) the month's DRAFT payroll run. */
  async computeRun(companyId: string, month: string) {
    const { start, end } = monthWindow(month);
    const existing = await this.prisma.payrollRun.findUnique({
      where: { companyId_month: { companyId, month } },
    });
    if (existing?.status === PayrollStatus.FINALIZED) {
      throw new ConflictException("Payroll for this month is finalized");
    }

    const staff = await this.prisma.staff.findMany({
      where: { companyId, active: true, salaryType: { not: null } },
      include: {
        timeEntries: {
          where: { clockIn: { gte: start, lt: end }, clockOut: { not: null } },
        },
      },
    });
    if (staff.length === 0) {
      throw new BadRequestException(
        "No staff with salary setup — set salary type on the Staff page first",
      );
    }

    const items = staff.map((s) => {
      let hours: number | null = null;
      let gross: number;
      if (s.salaryType === SalaryType.MONTHLY) {
        gross = s.monthlySalaryCents ?? 0;
      } else {
        hours = round2(
          s.timeEntries.reduce(
            (sum, e) => sum + (e.clockOut!.getTime() - e.clockIn.getTime()) / 3_600_000,
            0,
          ),
        );
        gross = Math.round(hours * (s.hourlyRateCents ?? 0));
      }
      const c = statutory(gross);
      return {
        staffId: s.id,
        staffName: s.name,
        salaryType: s.salaryType!,
        hoursWorked: hours,
        grossCents: gross,
        epfEmployeeCents: c.epfEmployee,
        epfEmployerCents: c.epfEmployer,
        socsoEmployeeCents: c.socsoEmployee,
        socsoEmployerCents: c.socsoEmployer,
        eisEmployeeCents: c.eisEmployee,
        eisEmployerCents: c.eisEmployer,
        netCents: gross - c.epfEmployee - c.socsoEmployee - c.eisEmployee,
      };
    });

    const run = await this.prisma.$transaction(async (tx) => {
      const run = existing
        ? existing
        : await tx.payrollRun.create({ data: { companyId, month } });
      await tx.payrollItem.deleteMany({ where: { runId: run.id } });
      await tx.payrollItem.createMany({
        data: items.map((i) => ({ ...i, runId: run.id })),
      });
      return run;
    });
    return this.getRun(companyId, run.id);
  }

  listRuns(companyId: string) {
    return this.prisma.payrollRun.findMany({
      where: { companyId },
      orderBy: { month: "desc" },
      include: { _count: { select: { items: true } } },
    });
  }

  async getRun(companyId: string, id: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, companyId },
      include: { items: { orderBy: { staffName: "asc" } } },
    });
    if (!run) throw new NotFoundException("Payroll run not found");
    const totals = run.items.reduce(
      (t, i) => ({
        grossCents: t.grossCents + i.grossCents,
        netCents: t.netCents + i.netCents,
        employerCostCents:
          t.employerCostCents +
          i.grossCents +
          i.epfEmployerCents +
          i.socsoEmployerCents +
          i.eisEmployerCents,
      }),
      { grossCents: 0, netCents: 0, employerCostCents: 0 },
    );
    return { ...run, totals };
  }

  async finalize(companyId: string, id: string) {
    const run = await this.prisma.payrollRun.findFirst({ where: { id, companyId } });
    if (!run) throw new NotFoundException("Payroll run not found");
    if (run.status === PayrollStatus.FINALIZED) {
      throw new ConflictException("Already finalized");
    }
    await this.prisma.payrollRun.update({
      where: { id },
      data: { status: PayrollStatus.FINALIZED, finalizedAt: new Date() },
    });
    return this.getRun(companyId, id);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
