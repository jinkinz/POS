import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { IngredientUnit, Prisma, StockMovementType } from "@pos/db";
import { PrismaService } from "../prisma.service";

type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;

/** What the deduction hook needs to know about each sold item. */
export interface SoldItem {
  productId: string;
  quantity: number;
  modifierIds: string[];
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- sale hooks (called inside the order transaction) ----------

  /**
   * Applies recipe consumption for sold items. sign=-1 deducts (sale),
   * sign=+1 restores (void). Items without recipes are ignored. Stock may
   * go negative on purpose: it records reality and surfaces variance.
   */
  async applyForItems(
    tx: Tx,
    outletId: string,
    items: SoldItem[],
    refId: string,
    sign: 1 | -1,
  ): Promise<void> {
    if (items.length === 0) return;
    const productIds = [...new Set(items.map((i) => i.productId))];
    const modifierIds = [...new Set(items.flatMap((i) => i.modifierIds))];

    const [recipes, modRecipes] = await Promise.all([
      tx.recipeItem.findMany({ where: { productId: { in: productIds } } }),
      modifierIds.length > 0
        ? tx.modifierRecipeItem.findMany({ where: { modifierId: { in: modifierIds } } })
        : Promise.resolve([]),
    ]);
    if (recipes.length === 0 && modRecipes.length === 0) return;

    const byProduct = new Map<string, typeof recipes>();
    for (const r of recipes) {
      byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r]);
    }
    const byModifier = new Map<string, typeof modRecipes>();
    for (const r of modRecipes) {
      byModifier.set(r.modifierId, [...(byModifier.get(r.modifierId) ?? []), r]);
    }

    // Aggregate total consumption per ingredient across the whole item set.
    const totals = new Map<string, Prisma.Decimal>();
    const add = (ingredientId: string, qty: Prisma.Decimal) =>
      totals.set(ingredientId, (totals.get(ingredientId) ?? new D(0)).add(qty));

    for (const item of items) {
      for (const r of byProduct.get(item.productId) ?? []) {
        add(r.ingredientId, r.qty.mul(item.quantity));
      }
      for (const modifierId of item.modifierIds) {
        for (const r of byModifier.get(modifierId) ?? []) {
          add(r.ingredientId, r.qty.mul(item.quantity));
        }
      }
    }

    for (const [ingredientId, qty] of totals) {
      const delta = qty.mul(sign);
      await tx.outletIngredient.upsert({
        where: { outletId_ingredientId: { outletId, ingredientId } },
        create: { outletId, ingredientId, onHandQty: delta },
        update: { onHandQty: { increment: delta } },
      });
      await tx.stockMovement.create({
        data: {
          outletId,
          ingredientId,
          type: sign === -1 ? StockMovementType.SALE_DEDUCT : StockMovementType.VOID_RETURN,
          qtyDelta: delta,
          refId,
        },
      });
    }
  }

  // ---------- ingredients ----------

  createIngredient(
    companyId: string,
    dto: { name: string; unit: IngredientUnit; costCents?: number; },
  ) {
    return this.prisma.ingredient.create({
      data: {
        companyId,
        name: dto.name,
        unit: dto.unit,
        costCents: dto.costCents ?? 0,
      },
    });
  }

  async updateIngredient(
    companyId: string,
    id: string,
    dto: { name?: string; costCents?: number; active?: boolean },
  ) {
    await this.mustOwnIngredient(companyId, id);
    return this.prisma.ingredient.update({ where: { id }, data: { ...dto } });
  }

  // ---------- recipes ----------

  async getProductRecipe(companyId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      include: { recipeItems: { include: { ingredient: true } } },
    });
    if (!product) throw new NotFoundException("Product not found");
    const items = product.recipeItems.map((r) => ({
      ingredientId: r.ingredientId,
      name: r.ingredient.name,
      unit: r.ingredient.unit,
      qty: r.qty,
      costCents: r.ingredient.costCents.mul(r.qty),
    }));
    return {
      productId,
      items,
      theoreticalCostCents: items
        .reduce((s, i) => s.add(i.costCents), new D(0))
        .toDecimalPlaces(2),
    };
  }

  async setProductRecipe(
    companyId: string,
    productId: string,
    items: { ingredientId: string; qty: number }[],
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
    });
    if (!product) throw new NotFoundException("Product not found");
    await this.validateIngredients(companyId, items.map((i) => i.ingredientId));
    await this.prisma.$transaction([
      this.prisma.recipeItem.deleteMany({ where: { productId } }),
      this.prisma.recipeItem.createMany({
        data: items.map((i) => ({ productId, ingredientId: i.ingredientId, qty: i.qty })),
      }),
    ]);
    return this.getProductRecipe(companyId, productId);
  }

  async setModifierRecipe(
    companyId: string,
    modifierId: string,
    items: { ingredientId: string; qty: number }[],
  ) {
    const modifier = await this.prisma.modifier.findFirst({
      where: { id: modifierId, group: { companyId } },
    });
    if (!modifier) throw new NotFoundException("Modifier not found");
    await this.validateIngredients(companyId, items.map((i) => i.ingredientId));
    await this.prisma.$transaction([
      this.prisma.modifierRecipeItem.deleteMany({ where: { modifierId } }),
      this.prisma.modifierRecipeItem.createMany({
        data: items.map((i) => ({ modifierId, ingredientId: i.ingredientId, qty: i.qty })),
      }),
    ]);
    return { ok: true };
  }

  // ---------- stock operations ----------

  async outletStock(companyId: string, outletId: string) {
    await this.mustOwnOutlet(companyId, outletId);
    const ingredients = await this.prisma.ingredient.findMany({
      where: { companyId, active: true },
      orderBy: { name: "asc" },
      include: { stockLevels: { where: { outletId } } },
    });
    return ingredients.map((ing) => {
      const level = ing.stockLevels[0];
      const onHand = level?.onHandQty ?? new D(0);
      const low = level?.lowThresholdQty;
      return {
        ingredientId: ing.id,
        name: ing.name,
        unit: ing.unit,
        costCents: ing.costCents,
        onHandQty: onHand,
        lowThresholdQty: low ?? null,
        lowStock: low != null && onHand.lte(low),
      };
    });
  }

  async receive(
    companyId: string,
    outletId: string,
    staffId: string | undefined,
    dto: { ingredientId: string; qty: number; unitCostCents?: number; reason?: string },
  ) {
    if (dto.qty <= 0) throw new BadRequestException("qty must be positive");
    return this.move(companyId, outletId, staffId, {
      ingredientId: dto.ingredientId,
      qtyDelta: dto.qty,
      type: StockMovementType.PURCHASE,
      reason: dto.reason,
      updateCostCents: dto.unitCostCents,
    });
  }

  async adjust(
    companyId: string,
    outletId: string,
    staffId: string | undefined,
    dto: { ingredientId: string; qtyDelta: number; reason: string },
  ) {
    if (dto.qtyDelta === 0) throw new BadRequestException("qtyDelta must be non-zero");
    return this.move(companyId, outletId, staffId, {
      ...dto,
      type: StockMovementType.ADJUSTMENT,
    });
  }

  async wastage(
    companyId: string,
    outletId: string,
    staffId: string | undefined,
    dto: { ingredientId: string; qty: number; reason: string },
  ) {
    if (dto.qty <= 0) throw new BadRequestException("qty must be positive");
    return this.move(companyId, outletId, staffId, {
      ingredientId: dto.ingredientId,
      qtyDelta: -dto.qty,
      type: StockMovementType.WASTAGE,
      reason: dto.reason,
    });
  }

  /** Set counted quantities; the delta between counted and system is the variance. */
  async stocktake(
    companyId: string,
    outletId: string,
    staffId: string | undefined,
    counts: { ingredientId: string; countedQty: number }[],
  ) {
    await this.mustOwnOutlet(companyId, outletId);
    await this.validateIngredients(companyId, counts.map((c) => c.ingredientId));
    const results: { ingredientId: string; varianceQty: string }[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const count of counts) {
        const level = await tx.outletIngredient.findUnique({
          where: { outletId_ingredientId: { outletId, ingredientId: count.ingredientId } },
        });
        const onHand = level?.onHandQty ?? new D(0);
        const variance = new D(count.countedQty).sub(onHand);
        await tx.outletIngredient.upsert({
          where: { outletId_ingredientId: { outletId, ingredientId: count.ingredientId } },
          create: { outletId, ingredientId: count.ingredientId, onHandQty: count.countedQty },
          update: { onHandQty: count.countedQty },
        });
        if (!variance.isZero()) {
          await tx.stockMovement.create({
            data: {
              outletId,
              ingredientId: count.ingredientId,
              type: StockMovementType.STOCKTAKE,
              qtyDelta: variance,
              reason: "stocktake variance",
              staffId,
            },
          });
        }
        results.push({ ingredientId: count.ingredientId, varianceQty: variance.toString() });
      }
    });
    return { results };
  }

  async setLowThreshold(
    companyId: string,
    outletId: string,
    dto: { ingredientId: string; lowThresholdQty: number | null },
  ) {
    await this.mustOwnOutlet(companyId, outletId);
    await this.validateIngredients(companyId, [dto.ingredientId]);
    await this.prisma.outletIngredient.upsert({
      where: { outletId_ingredientId: { outletId, ingredientId: dto.ingredientId } },
      create: {
        outletId,
        ingredientId: dto.ingredientId,
        lowThresholdQty: dto.lowThresholdQty,
      },
      update: { lowThresholdQty: dto.lowThresholdQty },
    });
    return { ok: true };
  }

  async movements(
    companyId: string,
    outletId: string,
    ingredientId?: string,
    days = 7,
  ) {
    await this.mustOwnOutlet(companyId, outletId);
    return this.prisma.stockMovement.findMany({
      where: {
        outletId,
        ...(ingredientId ? { ingredientId } : {}),
        createdAt: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { ingredient: { select: { name: true, unit: true } } },
    });
  }

  // ---------- internals ----------

  private async move(
    companyId: string,
    outletId: string,
    staffId: string | undefined,
    op: {
      ingredientId: string;
      qtyDelta: number;
      type: StockMovementType;
      reason?: string;
      updateCostCents?: number;
    },
  ) {
    await this.mustOwnOutlet(companyId, outletId);
    await this.validateIngredients(companyId, [op.ingredientId]);
    const [level] = await this.prisma.$transaction([
      this.prisma.outletIngredient.upsert({
        where: { outletId_ingredientId: { outletId, ingredientId: op.ingredientId } },
        create: { outletId, ingredientId: op.ingredientId, onHandQty: op.qtyDelta },
        update: { onHandQty: { increment: op.qtyDelta } },
      }),
      this.prisma.stockMovement.create({
        data: {
          outletId,
          ingredientId: op.ingredientId,
          type: op.type,
          qtyDelta: op.qtyDelta,
          reason: op.reason,
          staffId,
        },
      }),
      ...(op.updateCostCents != null
        ? [
            this.prisma.ingredient.update({
              where: { id: op.ingredientId },
              data: { costCents: op.updateCostCents },
            }),
          ]
        : []),
    ]);
    return { ingredientId: op.ingredientId, onHandQty: level.onHandQty };
  }

  private async validateIngredients(companyId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const count = await this.prisma.ingredient.count({
      where: { id: { in: unique }, companyId },
    });
    if (count !== unique.length) {
      throw new BadRequestException("Unknown ingredient in request");
    }
  }

  private async mustOwnIngredient(companyId: string, id: string) {
    const found = await this.prisma.ingredient.findFirst({ where: { id, companyId } });
    if (!found) throw new NotFoundException("Ingredient not found");
  }

  private async mustOwnOutlet(companyId: string, id: string) {
    const found = await this.prisma.outlet.findFirst({ where: { id, companyId } });
    if (!found) throw new NotFoundException("Outlet not found");
  }
}
