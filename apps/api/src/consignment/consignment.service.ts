import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SettlementStatus } from "@pos/db";
import { PrismaService } from "../prisma.service";

/** "YYYY-MM" -> [start, end) at fixed UTC+8. */
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
export class ConsignmentService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- consignors ----------

  create(
    companyId: string,
    dto: { name: string; phone?: string; email?: string; commissionBps?: number },
  ) {
    return this.prisma.consignor.create({
      data: { companyId, ...dto },
    });
  }

  async list(companyId: string) {
    const consignors = await this.prisma.consignor.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true, settlements: true } } },
    });
    return consignors.map((c) => ({
      ...c,
      productCount: c._count.products,
      settlementCount: c._count.settlements,
      _count: undefined,
    }));
  }

  async update(
    companyId: string,
    id: string,
    dto: { name?: string; phone?: string; email?: string; commissionBps?: number; active?: boolean },
  ) {
    const found = await this.prisma.consignor.findFirst({ where: { id, companyId } });
    if (!found) throw new NotFoundException("Consignor not found");
    return this.prisma.consignor.update({ where: { id }, data: { ...dto } });
  }

  // ---------- settlements ----------

  /** Consigned sales in the month, before generating the statement. */
  async preview(companyId: string, consignorId: string, month: string) {
    const consignor = await this.mustOwn(companyId, consignorId);
    const { start, end } = monthWindow(month);
    const sold = await this.soldItems(companyId, consignorId, start, end);
    const salesCents = sold.reduce((s, i) => s + i.amountCents, 0);
    const commissionCents = Math.round(
      (salesCents * consignor.commissionBps) / 10000,
    );
    return {
      month,
      consignorId,
      commissionBps: consignor.commissionBps,
      unitsSold: sold.reduce((s, i) => s + i.quantity, 0),
      salesCents,
      commissionCents,
      payoutCents: salesCents - commissionCents,
      lines: aggregateByProduct(sold),
    };
  }

  async generate(companyId: string, consignorId: string, month: string) {
    const consignor = await this.mustOwn(companyId, consignorId);
    const { start, end } = monthWindow(month);
    const dup = await this.prisma.consignmentSettlement.findFirst({
      where: { consignorId, periodStart: start },
    });
    if (dup) throw new ConflictException(`Settlement for ${month} already exists`);

    const sold = await this.soldItems(companyId, consignorId, start, end);
    if (sold.length === 0) {
      throw new BadRequestException("No consigned sales in this period");
    }
    const salesCents = sold.reduce((s, i) => s + i.amountCents, 0);
    const commissionCents = Math.round(
      (salesCents * consignor.commissionBps) / 10000,
    );
    return this.prisma.consignmentSettlement.create({
      data: {
        companyId,
        consignorId,
        periodStart: start,
        periodEnd: end,
        unitsSold: sold.reduce((s, i) => s + i.quantity, 0),
        salesCents,
        commissionCents,
        payoutCents: salesCents - commissionCents,
      },
    });
  }

  listSettlements(companyId: string) {
    return this.prisma.consignmentSettlement.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { consignor: { select: { name: true } } },
    });
  }

  async markPaid(companyId: string, id: string) {
    const settlement = await this.prisma.consignmentSettlement.findFirst({
      where: { id, companyId },
    });
    if (!settlement) throw new NotFoundException("Settlement not found");
    if (settlement.status === SettlementStatus.PAID) {
      throw new ConflictException("Already paid");
    }
    return this.prisma.consignmentSettlement.update({
      where: { id },
      data: { status: SettlementStatus.PAID, paidAt: new Date() },
    });
  }

  // ---------- internals ----------

  private async mustOwn(companyId: string, consignorId: string) {
    const consignor = await this.prisma.consignor.findFirst({
      where: { id: consignorId, companyId },
    });
    if (!consignor) throw new NotFoundException("Consignor not found");
    return consignor;
  }

  /** Non-voided items of COMPLETED orders for this consignor's products. */
  private async soldItems(
    companyId: string,
    consignorId: string,
    start: Date,
    end: Date,
  ) {
    const items = await this.prisma.orderItem.findMany({
      where: {
        status: { not: "VOIDED" },
        product: { consignorId },
        order: {
          companyId,
          status: "COMPLETED",
          closedAt: { gte: start, lt: end },
        },
      },
      select: {
        productId: true,
        nameSnapshot: true,
        quantity: true,
        unitPriceCents: true,
        modifiersJson: true,
      },
    });
    return items.map((i) => {
      const mods = (i.modifiersJson as { priceDeltaCents: number }[]).reduce(
        (s, m) => s + m.priceDeltaCents,
        0,
      );
      return {
        productId: i.productId!,
        name: i.nameSnapshot,
        quantity: i.quantity,
        amountCents: (i.unitPriceCents + mods) * i.quantity,
      };
    });
  }
}

function aggregateByProduct(
  items: { productId: string; name: string; quantity: number; amountCents: number }[],
) {
  const map = new Map<string, { name: string; quantity: number; amountCents: number }>();
  for (const i of items) {
    const row = map.get(i.productId) ?? { name: i.name, quantity: 0, amountCents: 0 };
    row.quantity += i.quantity;
    row.amountCents += i.amountCents;
    map.set(i.productId, row);
  }
  return [...map.values()].sort((a, b) => b.amountCents - a.amountCents);
}
