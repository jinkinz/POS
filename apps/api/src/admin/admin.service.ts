import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@pos/db";
import { hashSecret, verifySecret } from "../auth/hashing";
import { PrismaService } from "../prisma.service";
import {
  CreateCategoryDto,
  CreateModifierDto,
  CreateModifierGroupDto,
  CreateProductDto,
  CreateTableDto,
  UpdateCategoryDto,
  UpdateModifierDto,
  UpdateModifierGroupDto,
  UpdateOutletDto,
  UpdateProductDto,
  UpdateStaffDto,
  UpdateTableDto,
} from "./dto";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- catalog (full view, including inactive) ----------

  async catalog(companyId: string) {
    const [categories, products, groups] = await Promise.all([
      this.prisma.category.findMany({
        where: { companyId },
        orderBy: { sortOrder: "asc" },
      }),
      this.prisma.product.findMany({
        where: { companyId },
        orderBy: { name: "asc" },
        include: { modifierGroups: { orderBy: { sortOrder: "asc" } } },
      }),
      this.prisma.modifierGroup.findMany({
        where: { companyId },
        include: { modifiers: { orderBy: { sortOrder: "asc" } } },
      }),
    ]);
    return {
      categories,
      products: products.map((p) => ({
        ...p,
        modifierGroupIds: p.modifierGroups.map((g) => g.groupId),
        modifierGroups: undefined,
      })),
      modifierGroups: groups,
    };
  }

  createCategory(companyId: string, dto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: { companyId, name: dto.name, sortOrder: dto.sortOrder ?? 0 },
    });
  }

  async updateCategory(companyId: string, id: string, dto: UpdateCategoryDto) {
    await this.mustOwn(this.prisma.category, id, companyId, "Category");
    return this.prisma.category.update({ where: { id }, data: { ...dto } });
  }

  async createProduct(companyId: string, dto: CreateProductDto) {
    if (dto.categoryId) {
      await this.mustOwn(this.prisma.category, dto.categoryId, companyId, "Category");
    }
    return this.prisma.product.create({ data: { companyId, ...dto } });
  }

  async updateProduct(companyId: string, id: string, dto: UpdateProductDto) {
    await this.mustOwn(this.prisma.product, id, companyId, "Product");
    if (dto.categoryId) {
      await this.mustOwn(this.prisma.category, dto.categoryId, companyId, "Category");
    }
    return this.prisma.product.update({ where: { id }, data: { ...dto } });
  }

  createModifierGroup(companyId: string, dto: CreateModifierGroupDto) {
    return this.prisma.modifierGroup.create({
      data: { companyId, ...dto },
      include: { modifiers: true },
    });
  }

  async updateModifierGroup(companyId: string, id: string, dto: UpdateModifierGroupDto) {
    await this.mustOwn(this.prisma.modifierGroup, id, companyId, "Modifier group");
    return this.prisma.modifierGroup.update({
      where: { id },
      data: { ...dto },
      include: { modifiers: true },
    });
  }

  async createModifier(companyId: string, groupId: string, dto: CreateModifierDto) {
    await this.mustOwn(this.prisma.modifierGroup, groupId, companyId, "Modifier group");
    return this.prisma.modifier.create({ data: { groupId, ...dto } });
  }

  async updateModifier(companyId: string, id: string, dto: UpdateModifierDto) {
    const modifier = await this.prisma.modifier.findFirst({
      where: { id, group: { companyId } },
    });
    if (!modifier) throw new NotFoundException("Modifier not found");
    return this.prisma.modifier.update({ where: { id }, data: { ...dto } });
  }

  async attachGroup(companyId: string, productId: string, groupId: string, sortOrder = 0) {
    await this.mustOwn(this.prisma.product, productId, companyId, "Product");
    await this.mustOwn(this.prisma.modifierGroup, groupId, companyId, "Modifier group");
    await this.prisma.productModifierGroup.upsert({
      where: { productId_groupId: { productId, groupId } },
      create: { productId, groupId, sortOrder },
      update: { sortOrder },
    });
    return { ok: true };
  }

  async detachGroup(companyId: string, productId: string, groupId: string) {
    await this.mustOwn(this.prisma.product, productId, companyId, "Product");
    await this.prisma.productModifierGroup.deleteMany({
      where: { productId, groupId },
    });
    return { ok: true };
  }

  // ---------- company settings ----------

  async getCompany(companyId: string) {
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    return {
      id: c.id,
      name: c.name,
      country: c.country,
      currency: c.currency,
      timezone: c.timezone,
      loyaltyEarnPerCurrencyUnit: c.loyaltyEarnPerCurrencyUnit,
      loyaltyRedeemCentsPerPoint: c.loyaltyRedeemCentsPerPoint,
    };
  }

  async updateCompany(
    companyId: string,
    dto: {
      name?: string;
      loyaltyEarnPerCurrencyUnit?: number;
      loyaltyRedeemCentsPerPoint?: number;
    },
  ) {
    await this.prisma.company.update({ where: { id: companyId }, data: { ...dto } });
    return this.getCompany(companyId);
  }

  // ---------- outlets & tables ----------

  listOutlets(companyId: string) {
    return this.prisma.outlet.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
    });
  }

  async updateOutlet(companyId: string, id: string, dto: UpdateOutletDto) {
    await this.mustOwn(this.prisma.outlet, id, companyId, "Outlet");
    return this.prisma.outlet.update({ where: { id }, data: { ...dto } });
  }

  async createTable(companyId: string, outletId: string, dto: CreateTableDto) {
    await this.mustOwn(this.prisma.outlet, outletId, companyId, "Outlet");
    return this.prisma.diningTable.create({
      data: { outletId, name: dto.name, zone: dto.zone, seats: dto.seats ?? 2 },
    });
  }

  async updateTable(companyId: string, id: string, dto: UpdateTableDto) {
    const table = await this.prisma.diningTable.findFirst({
      where: { id, outlet: { companyId } },
    });
    if (!table) throw new NotFoundException("Table not found");
    return this.prisma.diningTable.update({ where: { id }, data: { ...dto } });
  }

  // ---------- staff ----------

  async listStaff(companyId: string) {
    const staff = await this.prisma.staff.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
    });
    return staff.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      phone: s.phone,
      role: s.role,
      active: s.active,
      hasPin: !!s.pinHash,
      hasPassword: !!s.passwordHash,
      salaryType: s.salaryType,
      monthlySalaryCents: s.monthlySalaryCents,
      hourlyRateCents: s.hourlyRateCents,
      createdAt: s.createdAt,
    }));
  }

  async updateStaff(companyId: string, id: string, dto: UpdateStaffDto) {
    const staff = await this.prisma.staff.findFirst({ where: { id, companyId } });
    if (!staff) throw new NotFoundException("Staff not found");

    const data: Prisma.StaffUpdateInput = {
      name: dto.name,
      role: dto.role,
      active: dto.active,
      salaryType: dto.salaryType,
      monthlySalaryCents: dto.monthlySalaryCents,
      hourlyRateCents: dto.hourlyRateCents,
    };
    if (dto.pin) {
      const others = await this.prisma.staff.findMany({
        where: { companyId, active: true, pinHash: { not: null }, id: { not: id } },
      });
      for (const other of others) {
        if (await verifySecret(dto.pin, other.pinHash)) {
          throw new BadRequestException("PIN already in use by another staff member");
        }
      }
      data.pinHash = await hashSecret(dto.pin);
    }
    if (dto.password) data.passwordHash = await hashSecret(dto.password);

    const updated = await this.prisma.staff.update({ where: { id }, data });
    return { id: updated.id, name: updated.name, role: updated.role, active: updated.active };
  }

  // ---------- daily report ----------

  /**
   * Sales summary for one calendar day. Both target markets (MY & SG) are
   * permanently UTC+8 with no DST, so day boundaries use a fixed offset.
   */
  async dailyReport(companyId: string, outletId: string, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException("date must be YYYY-MM-DD");
    }
    await this.mustOwn(this.prisma.outlet, outletId, companyId, "Outlet");
    const start = new Date(`${date}T00:00:00+08:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const orders = await this.prisma.order.findMany({
      where: { outletId, openedAt: { gte: start, lt: end } },
      include: { items: true, payments: true },
    });

    const completed = orders.filter((o) => o.status === "COMPLETED");
    const voided = orders.filter((o) => o.status === "VOIDED");
    const open = orders.filter((o) => o.status === "OPEN");

    const revenueCents = completed.reduce(
      (s, o) => s + o.totalCents + o.roundingCents,
      0,
    );

    const byPayment = new Map<string, { amountCents: number; count: number }>();
    for (const order of orders) {
      for (const p of order.payments) {
        if (p.status !== "CAPTURED") continue;
        const row = byPayment.get(p.method) ?? { amountCents: 0, count: 0 };
        row.amountCents += p.amountCents;
        row.count += 1;
        byPayment.set(p.method, row);
      }
    }

    const itemAgg = new Map<string, { quantity: number; salesCents: number }>();
    let voidedItems = 0;
    for (const order of orders) {
      if (order.status === "VOIDED") continue;
      for (const item of order.items) {
        if (item.status === "VOIDED") {
          voidedItems += 1;
          continue;
        }
        const mods = (
          item.modifiersJson as { priceDeltaCents: number }[]
        ).reduce((s, m) => s + m.priceDeltaCents, 0);
        const row = itemAgg.get(item.nameSnapshot) ?? { quantity: 0, salesCents: 0 };
        row.quantity += item.quantity;
        row.salesCents += (item.unitPriceCents + mods) * item.quantity;
        itemAgg.set(item.nameSnapshot, row);
      }
    }

    return {
      date,
      outletId,
      revenueCents,
      orderCount: completed.length,
      openCount: open.length,
      voidedCount: voided.length,
      voidedItems,
      averageOrderCents:
        completed.length > 0 ? Math.round(revenueCents / completed.length) : 0,
      byPayment: [...byPayment.entries()]
        .map(([method, v]) => ({ method, ...v }))
        .sort((a, b) => b.amountCents - a.amountCents),
      topItems: [...itemAgg.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10),
      bySource: countBy(orders.filter((o) => o.status !== "VOIDED"), (o) => o.source),
    };
  }

  // ---------- helpers ----------

  private async mustOwn(
    delegate: { findFirst(args: { where: { id: string; companyId: string } }): Promise<unknown | null> },
    id: string,
    companyId: string,
    label: string,
  ) {
    const found = await delegate.findFirst({ where: { id, companyId } });
    if (!found) throw new NotFoundException(`${label} not found`);
  }
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}
