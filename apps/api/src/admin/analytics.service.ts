import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@pos/db";
import { PrismaService } from "../prisma.service";

/** MY/SG are permanently UTC+8; all bucketing uses that offset. */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

function parseDay(s: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new BadRequestException(`${label} must be YYYY-MM-DD`);
  }
  return new Date(`${s}T00:00:00+08:00`);
}

function dayKey(d: Date): string {
  return new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

function monthKey(d: Date): string {
  return dayKey(d).slice(0, 7);
}

/** 0 = Monday … 6 = Sunday, in local (+08:00) time. */
function weekdayIndex(d: Date): number {
  const wd = new Date(d.getTime() + TZ_OFFSET_MS).getUTCDay();
  return (wd + 6) % 7;
}

function localHour(d: Date): number {
  return new Date(d.getTime() + TZ_OFFSET_MS).getUTCHours();
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Owner analytics over a date range: revenue series, weekday/hour
   * patterns, item winners & losers with margins, mixes, and a
   * previous-period comparison.
   */
  async analytics(companyId: string, outletId: string, from: string, to: string) {
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: outletId, companyId },
    });
    if (!outlet) throw new NotFoundException("Outlet not found");

    const start = parseDay(from, "from");
    const endExclusive = new Date(parseDay(to, "to").getTime() + 86_400_000);
    if (endExclusive <= start) throw new BadRequestException("to must be >= from");
    const days = Math.round((endExclusive.getTime() - start.getTime()) / 86_400_000);
    if (days > 750) throw new BadRequestException("Range too large (max ~2 years)");
    const bucket: "day" | "month" = days > 92 ? "month" : "day";

    const orders = await this.prisma.order.findMany({
      where: {
        outletId,
        status: "COMPLETED",
        closedAt: { gte: start, lt: endExclusive },
      },
      include: {
        items: true,
        payments: { where: { status: "CAPTURED" } },
      },
    });

    // ---- revenue series + weekday/hour patterns ----
    const series = new Map<string, { revenueCents: number; orders: number }>();
    // Pre-fill every bucket in range so quiet days show as zero, not gaps.
    for (let t = start.getTime(); t < endExclusive.getTime(); t += 86_400_000) {
      const key = bucket === "day" ? dayKey(new Date(t)) : monthKey(new Date(t));
      if (!series.has(key)) series.set(key, { revenueCents: 0, orders: 0 });
    }
    const weekday = Array.from({ length: 7 }, () => ({ revenueCents: 0, orders: 0 }));
    const hourly = Array.from({ length: 24 }, () => ({ revenueCents: 0, orders: 0 }));

    let revenueCents = 0;
    for (const order of orders) {
      const paid = order.totalCents + order.roundingCents;
      revenueCents += paid;
      const at = order.closedAt!;
      const key = bucket === "day" ? dayKey(at) : monthKey(at);
      const row = series.get(key) ?? { revenueCents: 0, orders: 0 };
      row.revenueCents += paid;
      row.orders += 1;
      series.set(key, row);
      weekday[weekdayIndex(at)]!.revenueCents += paid;
      weekday[weekdayIndex(at)]!.orders += 1;
      hourly[localHour(at)]!.revenueCents += paid;
      hourly[localHour(at)]!.orders += 1;
    }

    // Weekday averages need occurrence counts of each weekday in the range.
    const weekdayOccurrences = Array.from({ length: 7 }, () => 0);
    for (let t = start.getTime(); t < endExclusive.getTime(); t += 86_400_000) {
      weekdayOccurrences[weekdayIndex(new Date(t))]! += 1;
    }

    // ---- items: winners, margins, and non-sellers ----
    const itemAgg = new Map<
      string,
      { productId: string | null; quantity: number; salesCents: number }
    >();
    for (const order of orders) {
      for (const item of order.items) {
        if (item.status === "VOIDED") continue;
        const mods = (item.modifiersJson as { priceDeltaCents: number }[]).reduce(
          (s, m) => s + m.priceDeltaCents,
          0,
        );
        const row = itemAgg.get(item.nameSnapshot) ?? {
          productId: item.productId,
          quantity: 0,
          salesCents: 0,
        };
        row.quantity += item.quantity;
        row.salesCents += (item.unitPriceCents + mods) * item.quantity;
        itemAgg.set(item.nameSnapshot, row);
      }
    }

    // Theoretical unit cost from recipes (where defined) for margin%.
    const productIds = [...itemAgg.values()]
      .map((i) => i.productId)
      .filter((id): id is string => !!id);
    const recipes = await this.prisma.recipeItem.findMany({
      where: { productId: { in: productIds } },
      include: { ingredient: { select: { costCents: true } } },
    });
    const unitCost = new Map<string, number>();
    for (const r of recipes) {
      unitCost.set(
        r.productId,
        (unitCost.get(r.productId) ?? 0) +
          r.qty.mul(r.ingredient.costCents).toNumber(),
      );
    }

    const items = [...itemAgg.entries()]
      .map(([name, v]) => {
        const cost = v.productId != null ? unitCost.get(v.productId) : undefined;
        const costCents = cost != null ? Math.round(cost * v.quantity) : null;
        return {
          name,
          quantity: v.quantity,
          salesCents: v.salesCents,
          costCents,
          marginPct:
            costCents != null && v.salesCents > 0
              ? Math.round((1 - costCents / v.salesCents) * 100)
              : null,
        };
      })
      .sort((a, b) => b.salesCents - a.salesCents);

    const soldNames = new Set(itemAgg.keys());
    const catalog = await this.prisma.product.findMany({
      where: { companyId, active: true },
      select: { name: true, basePriceCents: true },
      orderBy: { name: "asc" },
    });
    const notSelling = catalog
      .filter((p) => !soldNames.has(p.name))
      .map((p) => ({ name: p.name, priceCents: p.basePriceCents }))
      .slice(0, 30);

    // ---- mixes ----
    const categories = await this.categoryMix(companyId, orders);
    const payments = new Map<string, { amountCents: number; count: number }>();
    const sources = new Map<string, { revenueCents: number; orders: number }>();
    for (const order of orders) {
      for (const p of order.payments) {
        const row = payments.get(p.method) ?? { amountCents: 0, count: 0 };
        row.amountCents += p.amountCents;
        row.count += 1;
        payments.set(p.method, row);
      }
      const src = sources.get(order.source) ?? { revenueCents: 0, orders: 0 };
      src.revenueCents += order.totalCents + order.roundingCents;
      src.orders += 1;
      sources.set(order.source, src);
    }

    // ---- previous equal-length period comparison ----
    const prevStart = new Date(start.getTime() - days * 86_400_000);
    const prev = await this.prisma.order.aggregate({
      where: {
        outletId,
        status: "COMPLETED",
        closedAt: { gte: prevStart, lt: start },
      },
      _sum: { totalCents: true, roundingCents: true },
      _count: true,
    });
    const prevRevenue =
      (prev._sum.totalCents ?? 0) + (prev._sum.roundingCents ?? 0);

    return {
      from,
      to,
      bucket,
      totals: {
        revenueCents,
        orders: orders.length,
        averageOrderCents:
          orders.length > 0 ? Math.round(revenueCents / orders.length) : 0,
      },
      previous: {
        revenueCents: prevRevenue,
        orders: prev._count,
        revenueChangePct:
          prevRevenue > 0
            ? Math.round(((revenueCents - prevRevenue) / prevRevenue) * 100)
            : null,
        ordersChangePct:
          prev._count > 0
            ? Math.round(((orders.length - prev._count) / prev._count) * 100)
            : null,
      },
      series: [...series.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, v]) => ({ bucket: key, ...v })),
      weekday: weekday.map((w, i) => ({
        weekday: i, // 0 = Monday
        revenueCents: w.revenueCents,
        orders: w.orders,
        occurrences: weekdayOccurrences[i],
        avgRevenueCents:
          weekdayOccurrences[i]! > 0
            ? Math.round(w.revenueCents / weekdayOccurrences[i]!)
            : 0,
      })),
      hourly: hourly.map((h, i) => ({ hour: i, ...h })),
      items: items.slice(0, 25),
      notSelling,
      categories,
      payments: [...payments.entries()]
        .map(([method, v]) => ({ method, ...v }))
        .sort((a, b) => b.amountCents - a.amountCents),
      sources: [...sources.entries()]
        .map(([source, v]) => ({ source, ...v }))
        .sort((a, b) => b.revenueCents - a.revenueCents),
    };
  }

  private async categoryMix(
    companyId: string,
    orders: { items: { productId: string | null; nameSnapshot: string; quantity: number; unitPriceCents: number; modifiersJson: Prisma.JsonValue; status: string }[] }[],
  ) {
    const products = await this.prisma.product.findMany({
      where: { companyId },
      select: { id: true, category: { select: { name: true } } },
    });
    const catOf = new Map(products.map((p) => [p.id, p.category?.name ?? "Uncategorized"]));
    const agg = new Map<string, number>();
    for (const order of orders) {
      for (const item of order.items) {
        if (item.status === "VOIDED") continue;
        const mods = (item.modifiersJson as { priceDeltaCents: number }[]).reduce(
          (s, m) => s + m.priceDeltaCents,
          0,
        );
        const cat = item.productId
          ? (catOf.get(item.productId) ?? "Uncategorized")
          : "Aggregator/Other";
        agg.set(cat, (agg.get(cat) ?? 0) + (item.unitPriceCents + mods) * item.quantity);
      }
    }
    return [...agg.entries()]
      .map(([name, salesCents]) => ({ name, salesCents }))
      .sort((a, b) => b.salesCents - a.salesCents);
  }
}
