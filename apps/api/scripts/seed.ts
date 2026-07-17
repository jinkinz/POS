// Demo seed: a Malaysian kopitiam with SST 6%, 10% service charge, 5-sen
// cash rounding. Idempotent — safe to run repeatedly.
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@pos/db";

const prisma = new PrismaClient();

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function main() {
  const existing = await prisma.company.findFirst({
    where: { name: "Demo Kopitiam Sdn Bhd" },
    include: { outlets: true },
  });
  if (existing) {
    console.log("Seed already present.");
    console.log(`companyId=${existing.id}`);
    console.log(`outletId=${existing.outlets[0]?.id}`);
    return;
  }

  const company = await prisma.company.create({
    data: {
      name: "Demo Kopitiam Sdn Bhd",
      country: "MY",
      currency: "MYR",
      timezone: "Asia/Kuala_Lumpur",
    },
  });

  const outlet = await prisma.outlet.create({
    data: {
      companyId: company.id,
      name: "SS2 Outlet",
      address: "12 Jalan SS2/64, Petaling Jaya",
      serviceChargeBps: 1000, // 10%
      taxBps: 600, // SST 6%
      taxInclusive: false,
      serviceChargeTaxable: true,
      cashRounding: "MY_5_SEN",
    },
  });

  await prisma.staff.createMany({
    data: [
      {
        companyId: company.id,
        name: "Boss Lim",
        email: "owner@demokopitiam.my",
        role: "OWNER",
        pinHash: sha256("1234"),
      },
      {
        companyId: company.id,
        name: "Aisyah",
        role: "CASHIER",
        pinHash: sha256("5678"),
      },
    ],
  });

  await prisma.diningTable.createMany({
    data: ["T1", "T2", "T3", "T4"].map((name, i) => ({
      outletId: outlet.id,
      name,
      zone: i < 2 ? "Indoor" : "Outdoor",
      seats: 4,
      qrToken: randomUUID(),
    })),
  });

  const food = await prisma.category.create({
    data: { companyId: company.id, name: "Food", sortOrder: 1 },
  });
  const drinks = await prisma.category.create({
    data: { companyId: company.id, name: "Drinks", sortOrder: 2 },
  });

  const sugarGroup = await prisma.modifierGroup.create({
    data: {
      companyId: company.id,
      name: "Sugar level",
      minSelect: 0,
      maxSelect: 1,
      modifiers: {
        create: [
          { name: "Normal", priceDeltaCents: 0, sortOrder: 1 },
          { name: "Kurang manis", priceDeltaCents: 0, sortOrder: 2 },
          { name: "Kosong", priceDeltaCents: 0, sortOrder: 3 },
        ],
      },
    },
  });
  const addonGroup = await prisma.modifierGroup.create({
    data: {
      companyId: company.id,
      name: "Add-ons",
      minSelect: 0,
      maxSelect: 3,
      modifiers: {
        create: [
          { name: "Extra egg", priceDeltaCents: 150, sortOrder: 1 },
          { name: "Extra rice", priceDeltaCents: 200, sortOrder: 2 },
        ],
      },
    },
  });

  await prisma.product.create({
    data: {
      companyId: company.id,
      categoryId: food.id,
      name: "Hainanese Chicken Rice",
      basePriceCents: 1200,
      kitchenStation: "wok",
      modifierGroups: { create: [{ groupId: addonGroup.id, sortOrder: 1 }] },
    },
  });
  await prisma.product.create({
    data: {
      companyId: company.id,
      categoryId: food.id,
      name: "Nasi Lemak Ayam",
      basePriceCents: 950,
      kitchenStation: "wok",
      modifierGroups: { create: [{ groupId: addonGroup.id, sortOrder: 1 }] },
    },
  });
  await prisma.product.create({
    data: {
      companyId: company.id,
      categoryId: drinks.id,
      name: "Kopi O",
      basePriceCents: 280,
      kitchenStation: "drinks",
      modifierGroups: { create: [{ groupId: sugarGroup.id, sortOrder: 1 }] },
    },
  });
  await prisma.product.create({
    data: {
      companyId: company.id,
      categoryId: drinks.id,
      name: "Teh Tarik",
      basePriceCents: 320,
      kitchenStation: "drinks",
      modifierGroups: { create: [{ groupId: sugarGroup.id, sortOrder: 1 }] },
    },
  });

  console.log("Seeded demo data.");
  console.log(`companyId=${company.id}`);
  console.log(`outletId=${outlet.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
