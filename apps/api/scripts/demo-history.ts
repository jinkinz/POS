// DEMO DATA GENERATOR — inserts synthetic completed orders over the past
// N days so the Analytics page has history to show. Dev/demo use only.
//   pnpm --filter @pos/api demo-history           (default 180 days)
//   pnpm --filter @pos/api demo-history -- 365
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@pos/db";

const prisma = new PrismaClient();
const DAYS = Math.min(730, parseInt(process.argv[2] ?? "180", 10) || 180);

/** Deterministic-ish PRNG so reruns look similar. */
let seed = 42;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
}
function pick<T>(arr: T[], weights?: number[]): T {
  if (!weights) return arr[Math.floor(rnd() * arr.length)]!;
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return arr[i]!;
  }
  return arr[arr.length - 1]!;
}

async function main() {
  const company = await prisma.company.findFirstOrThrow({
    include: { outlets: true },
  });
  const outlet = company.outlets[0]!;
  const products = await prisma.product.findMany({
    where: { companyId: company.id, active: true, basePriceCents: { gt: 0 } },
  });
  if (products.length === 0) throw new Error("Seed the menu first (pnpm --filter @pos/api seed)");

  const already = await prisma.order.count({
    where: { outletId: outlet.id, notes: "demo-history" },
  });
  if (already > 0) {
    console.log(`demo-history already present (${already} orders) — delete them first if you want to regenerate.`);
    return;
  }

  // Popularity weights: a few stars, a long tail.
  const weights = products.map((_, i) => Math.max(1, 10 - i * 2 + rnd() * 4));

  const svc = outlet.serviceChargeBps;
  const tax = outlet.taxBps;
  let created = 0;

  for (let d = DAYS; d >= 1; d--) {
    const day = new Date(Date.now() - d * 86_400_000);
    const weekday = (new Date(day.getTime() + 8 * 3600_000).getUTCDay() + 6) % 7; // 0=Mon
    // Weekends busier; slow growth over time; Monday slowest.
    const base = 10 + (weekday >= 5 ? 10 : 0) - (weekday === 0 ? 4 : 0);
    const growth = 1 + ((DAYS - d) / DAYS) * 0.35;
    const orderCount = Math.round((base + rnd() * 6) * growth);

    for (let i = 0; i < orderCount; i++) {
      // Lunch (12-14) and dinner (18-20) peaks.
      const hour = pick(
        [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
        [2, 2, 3, 5, 10, 10, 6, 3, 3, 5, 9, 10, 7, 3],
      );
      const at = new Date(`${day.toISOString().slice(0, 10)}T00:00:00+08:00`);
      at.setTime(at.getTime() + hour * 3600_000 + Math.floor(rnd() * 3600_000));

      const lineCount = 1 + Math.floor(rnd() * 3);
      const items = Array.from({ length: lineCount }, () => {
        const product = pick(products, weights);
        return { product, quantity: 1 + (rnd() < 0.3 ? 1 : 0) };
      });
      const subtotal = items.reduce(
        (s, it) => s + it.product.basePriceCents * it.quantity,
        0,
      );
      const svcCents = Math.floor((subtotal * svc + 5000) / 10000);
      const taxCents = Math.floor(((subtotal + svcCents) * tax + 5000) / 10000);
      const total = subtotal + svcCents + taxCents;
      const method = pick(["CASH", "CARD", "QR_WALLET"], [5, 3, 3]);
      const rounding =
        method === "CASH" && outlet.cashRounding === "MY_5_SEN"
          ? Math.round(total / 5) * 5 - total
          : 0;
      const source = pick(["POS", "QR", "AGGREGATOR"], [7, 2, 1]);

      await prisma.order.create({
        data: {
          id: randomUUID(),
          companyId: company.id,
          outletId: outlet.id,
          orderNo: 9000 + i,
          type: source === "AGGREGATOR" ? "DELIVERY" : pick(["DINE_IN", "TAKEAWAY"], [6, 4]),
          source: source as never,
          status: "COMPLETED",
          notes: "demo-history",
          openedAt: at,
          closedAt: new Date(at.getTime() + 15 * 60_000),
          subtotalCents: subtotal,
          serviceChargeCents: svcCents,
          taxCents,
          roundingCents: rounding,
          totalCents: total,
          items: {
            create: items.map((it) => ({
              id: randomUUID(),
              productId: it.product.id,
              nameSnapshot: it.product.name,
              unitPriceCents: it.product.basePriceCents,
              quantity: it.quantity,
              modifiersJson: [],
              status: "SERVED",
              station: it.product.kitchenStation,
            })),
          },
          payments: {
            create: {
              id: randomUUID(),
              method: method as never,
              amountCents: total + rounding,
              status: "CAPTURED",
              paidAt: new Date(at.getTime() + 14 * 60_000),
            },
          },
        },
      });
      created++;
    }
  }
  console.log(`Created ${created} demo orders across ${DAYS} days for ${outlet.name}.`);
  console.log("Open the back office → Analytics to see the history.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
