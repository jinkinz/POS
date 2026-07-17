import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  /** Full menu for one outlet — what POS/QR clients cache locally. */
  async outletMenu(outletId: string, companyId: string) {
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: outletId, companyId },
      include: { company: true },
    });
    if (!outlet) throw new NotFoundException("Outlet not found");

    const categories = await this.prisma.category.findMany({
      where: { companyId: outlet.companyId, active: true },
      orderBy: { sortOrder: "asc" },
      include: {
        products: {
          where: { active: true },
          include: {
            modifierGroups: {
              orderBy: { sortOrder: "asc" },
              include: {
                group: {
                  include: { modifiers: { orderBy: { sortOrder: "asc" } } },
                },
              },
            },
          },
        },
      },
    });

    return {
      outlet: {
        id: outlet.id,
        name: outlet.name,
        currency: outlet.company.currency,
        serviceChargeBps: outlet.serviceChargeBps,
        taxBps: outlet.taxBps,
        taxInclusive: outlet.taxInclusive,
        serviceChargeTaxable: outlet.serviceChargeTaxable,
        cashRounding: outlet.cashRounding,
      },
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        products: c.products.map((p) => ({
          id: p.id,
          name: p.name,
          priceCents: p.basePriceCents,
          soldOut: p.soldOut,
          imageUrl: p.imageUrl,
          modifierGroups: p.modifierGroups.map((pg) => ({
            id: pg.group.id,
            name: pg.group.name,
            minSelect: pg.group.minSelect,
            maxSelect: pg.group.maxSelect,
            modifiers: pg.group.modifiers.map((m) => ({
              id: m.id,
              name: m.name,
              priceDeltaCents: m.priceDeltaCents,
              soldOut: m.soldOut,
            })),
          })),
        })),
      })),
    };
  }

  async setSoldOut(productId: string, companyId: string, soldOut: boolean) {
    const existing = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
    });
    if (!existing) throw new NotFoundException("Product not found");
    const product = await this.prisma.product.update({
      where: { id: productId },
      data: { soldOut },
    });
    return { id: product.id, soldOut: product.soldOut };
  }
}
