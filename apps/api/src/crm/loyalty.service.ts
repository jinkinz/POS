import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PointsTxType,
  Prisma,
} from "@pos/db";
import { PrismaService } from "../prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

const MEMBER_SELECT = {
  id: true,
  phone: true,
  name: true,
  email: true,
  active: true,
  pointsBalance: true,
  lifetimeSpendCents: true,
  visits: true,
  lastVisitAt: true,
  createdAt: true,
} as const;

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ---------- members ----------

  async findByPhone(companyId: string, phone: string) {
    const member = await this.prisma.member.findUnique({
      where: { companyId_phone: { companyId, phone: normalizePhone(phone) } },
      select: MEMBER_SELECT,
    });
    return { member: member ?? null };
  }

  async create(
    companyId: string,
    dto: { phone: string; name?: string; email?: string },
  ) {
    const phone = normalizePhone(dto.phone);
    const existing = await this.prisma.member.findUnique({
      where: { companyId_phone: { companyId, phone } },
    });
    if (existing) throw new ConflictException("Member with this phone already exists");
    return this.prisma.member.create({
      data: { companyId, phone, name: dto.name, email: dto.email },
      select: MEMBER_SELECT,
    });
  }

  async detail(companyId: string, memberId: string) {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, companyId },
      select: {
        ...MEMBER_SELECT,
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            type: true,
            points: true,
            orderId: true,
            reason: true,
            createdAt: true,
          },
        },
        orders: {
          orderBy: { openedAt: "desc" },
          take: 10,
          select: {
            id: true,
            orderNo: true,
            status: true,
            totalCents: true,
            roundingCents: true,
            openedAt: true,
          },
        },
      },
    });
    if (!member) throw new NotFoundException("Member not found");
    return member;
  }

  async update(
    companyId: string,
    memberId: string,
    dto: { name?: string; email?: string; active?: boolean },
  ) {
    await this.mustOwn(companyId, memberId);
    return this.prisma.member.update({
      where: { id: memberId },
      data: { ...dto },
      select: MEMBER_SELECT,
    });
  }

  list(companyId: string, search?: string) {
    const q = search?.trim();
    return this.prisma.member.findMany({
      where: {
        companyId,
        ...(q
          ? {
              OR: [
                { phone: { contains: q } },
                { name: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: MEMBER_SELECT,
    });
  }

  /** Manager points correction; balance may not go negative. */
  async adjust(companyId: string, memberId: string, points: number, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.member.findFirst({ where: { id: memberId, companyId } });
      if (!member) throw new NotFoundException("Member not found");
      if (member.pointsBalance + points < 0) {
        throw new BadRequestException("Balance cannot go negative");
      }
      await tx.pointsTransaction.create({
        data: { memberId, type: PointsTxType.ADJUST, points, reason },
      });
      return tx.member.update({
        where: { id: memberId },
        data: { pointsBalance: { increment: points } },
        select: MEMBER_SELECT,
      });
    });
  }

  // ---------- order hooks ----------

  async attachToOrder(companyId: string, orderId: string, memberId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== OrderStatus.OPEN) {
      throw new ConflictException("Member must be attached before the order closes");
    }
    await this.mustOwn(companyId, memberId);
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { memberId },
      include: {
        items: { orderBy: { createdAt: "asc" } },
        payments: { orderBy: { paidAt: "asc" } },
      },
    });
    this.realtime.emitToOutlet(updated.outletId, "order.updated", updated);
    return updated;
  }

  /**
   * Awards earn points once per completed order with a member attached.
   * Safe to call from every settlement path — the (orderId, type) unique
   * constraint makes replays no-ops.
   */
  async awardForOrder(orderId: string): Promise<{ points: number } | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (!order || !order.memberId || order.status !== OrderStatus.COMPLETED) {
          return null;
        }
        const company = await tx.company.findUniqueOrThrow({
          where: { id: order.companyId },
        });
        const spentCents = order.totalCents + order.roundingCents;
        const points =
          Math.floor(spentCents / 100) * company.loyaltyEarnPerCurrencyUnit;
        await tx.pointsTransaction.create({
          data: {
            memberId: order.memberId,
            type: PointsTxType.EARN,
            points,
            orderId,
            reason: `Order #${order.orderNo ?? ""}`.trim(),
          },
        });
        await tx.member.update({
          where: { id: order.memberId },
          data: {
            pointsBalance: { increment: points },
            lifetimeSpendCents: { increment: spentCents },
            visits: { increment: 1 },
            lastVisitAt: new Date(),
          },
        });
        return { points };
      });
    } catch (e) {
      // Unique violation = already awarded (settlement hook replay).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return null;
      }
      throw e;
    }
  }

  /** Redeem points as (part of) payment on an open order. */
  async redeem(companyId: string, orderId: string, points: number) {
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, companyId },
        include: { payments: true, member: true },
      });
      if (!order) throw new NotFoundException("Order not found");
      if (order.status !== OrderStatus.OPEN) {
        throw new ConflictException(`Order is ${order.status}`);
      }
      if (!order.member) throw new BadRequestException("No member attached to order");
      if (order.member.pointsBalance < points) {
        throw new BadRequestException(
          `Member only has ${order.member.pointsBalance} points`,
        );
      }
      const company = await tx.company.findUniqueOrThrow({
        where: { id: order.companyId },
      });
      const valueCents = points * company.loyaltyRedeemCentsPerPoint;
      const paid = order.payments
        .filter((p) => p.status === PaymentStatus.CAPTURED)
        .reduce((s, p) => s + p.amountCents, 0);
      const remaining = order.totalCents + order.roundingCents - paid;
      if (remaining <= 0) throw new ConflictException("Order is already fully paid");
      if (valueCents > remaining) {
        throw new BadRequestException(
          `Redemption exceeds balance due (max ${Math.floor(remaining / company.loyaltyRedeemCentsPerPoint)} points)`,
        );
      }

      await tx.pointsTransaction.create({
        data: {
          memberId: order.member.id,
          type: PointsTxType.REDEEM,
          points: -points,
          orderId,
          reason: `Order #${order.orderNo ?? ""}`.trim(),
        },
      });
      await tx.member.update({
        where: { id: order.member.id },
        data: { pointsBalance: { decrement: points } },
      });
      await tx.payment.create({
        data: {
          id: randomUUID(),
          orderId,
          method: PaymentMethod.POINTS,
          amountCents: valueCents,
          status: PaymentStatus.CAPTURED,
        },
      });
      const settled = paid + valueCents >= order.totalCents + order.roundingCents;
      if (settled) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.COMPLETED, closedAt: new Date() },
        });
      }
      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          items: { orderBy: { createdAt: "asc" } },
          payments: { orderBy: { paidAt: "asc" } },
        },
      });
    });

    this.realtime.emitToOutlet(order.outletId, "order.updated", order);
    if (order.status === OrderStatus.COMPLETED) {
      await this.awardForOrder(order.id);
    }
    return order;
  }

  private async mustOwn(companyId: string, memberId: string) {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, companyId, active: true },
    });
    if (!member) throw new NotFoundException("Member not found");
    return member;
  }
}

/** Keep digits and a leading + so "012-345 6789" matches "0123456789". */
function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  return (trimmed.startsWith("+") ? "+" : "") + trimmed.replace(/\D/g, "");
}
