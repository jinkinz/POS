import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  Campaign,
  CampaignKind,
  DiscountType,
  OrderStatus,
  PaymentStatus,
  VoucherStatus,
} from "@pos/db";
import { computeOrderTotals, type OrderLineInput } from "@pos/shared";
import { PrismaService } from "../prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

const ORDER_INCLUDE = {
  items: { orderBy: { createdAt: "asc" as const } },
  payments: { orderBy: { paidAt: "asc" as const } },
};

@Injectable()
export class VouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ---------- campaigns (admin) ----------

  async createCampaign(
    companyId: string,
    dto: {
      name: string;
      kind: CampaignKind;
      code?: string;
      discountType: DiscountType;
      valueCents?: number;
      valueBps?: number;
      maxDiscountCents?: number;
      minSpendCents?: number;
      startsAt?: string;
      endsAt?: string;
      maxUses?: number;
    },
  ) {
    if (dto.discountType === DiscountType.AMOUNT && !dto.valueCents) {
      throw new BadRequestException("valueCents required for AMOUNT discounts");
    }
    if (dto.discountType === DiscountType.PERCENT && !dto.valueBps) {
      throw new BadRequestException("valueBps required for PERCENT discounts");
    }
    if (dto.kind === CampaignKind.CODE && !dto.code) {
      throw new BadRequestException("code required for CODE campaigns");
    }
    const code = dto.code?.trim().toUpperCase();
    if (code) {
      const clash = await this.prisma.campaign.findFirst({
        where: { companyId, code },
      });
      if (clash) throw new ConflictException("Code already in use");
    }
    return this.prisma.campaign.create({
      data: {
        companyId,
        name: dto.name,
        kind: dto.kind,
        code: dto.kind === CampaignKind.CODE ? code : null,
        discountType: dto.discountType,
        valueCents: dto.valueCents,
        valueBps: dto.valueBps,
        maxDiscountCents: dto.maxDiscountCents,
        minSpendCents: dto.minSpendCents ?? 0,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        maxUses: dto.maxUses,
      },
    });
  }

  async listCampaigns(companyId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { vouchers: true } } },
    });
    return campaigns.map((c) => ({
      ...c,
      issuedCount: c._count.vouchers,
      _count: undefined,
    }));
  }

  async updateCampaign(
    companyId: string,
    id: string,
    dto: { active?: boolean; endsAt?: string | null; maxUses?: number },
  ) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, companyId },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");
    return this.prisma.campaign.update({
      where: { id },
      data: {
        active: dto.active,
        maxUses: dto.maxUses,
        ...(dto.endsAt !== undefined
          ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null }
          : {}),
      },
    });
  }

  /** Issue a personal one-time voucher from an ISSUED campaign. */
  async issueVoucher(companyId: string, campaignId: string, memberId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, companyId },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");
    if (campaign.kind !== CampaignKind.ISSUED) {
      throw new BadRequestException("Only ISSUED campaigns produce personal vouchers");
    }
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, companyId, active: true },
    });
    if (!member) throw new NotFoundException("Member not found");
    return this.prisma.voucher.create({
      data: {
        campaignId,
        memberId,
        code: `V-${randomBytes(4).toString("hex").toUpperCase()}`,
      },
      include: { campaign: { select: { name: true } } },
    });
  }

  /** A member's usable vouchers (POS shows these at tender). */
  memberVouchers(companyId: string, memberId: string) {
    return this.prisma.voucher.findMany({
      where: {
        memberId,
        status: VoucherStatus.ISSUED,
        campaign: { companyId, active: true },
      },
      include: {
        campaign: {
          select: {
            name: true,
            discountType: true,
            valueCents: true,
            valueBps: true,
            maxDiscountCents: true,
            minSpendCents: true,
            endsAt: true,
          },
        },
      },
      orderBy: { issuedAt: "desc" },
    });
  }

  // ---------- apply / remove on orders ----------

  async apply(companyId: string, orderId: string, rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, companyId },
        include: { ...ORDER_INCLUDE, outlet: true },
      });
      if (!order) throw new NotFoundException("Order not found");
      if (order.status !== OrderStatus.OPEN) {
        throw new ConflictException(`Order is ${order.status}`);
      }
      if (order.payments.some((p) => p.status === PaymentStatus.CAPTURED)) {
        throw new ConflictException("Apply vouchers before taking payment");
      }
      if (order.voucherCode) {
        throw new ConflictException("A voucher is already applied — remove it first");
      }

      // Personal voucher first, then shared promo code.
      const voucher = await tx.voucher.findUnique({
        where: { code },
        include: { campaign: true },
      });
      let campaign: Campaign;
      let voucherId: string | null = null;
      let memberIdToAttach: string | null = null;

      if (voucher && voucher.campaign.companyId === companyId) {
        if (voucher.status !== VoucherStatus.ISSUED) {
          throw new ConflictException(`Voucher already ${voucher.status.toLowerCase()}`);
        }
        if (
          voucher.memberId &&
          order.memberId &&
          voucher.memberId !== order.memberId
        ) {
          throw new BadRequestException("Voucher belongs to a different member");
        }
        campaign = voucher.campaign;
        voucherId = voucher.id;
        if (voucher.memberId && !order.memberId) memberIdToAttach = voucher.memberId;
      } else {
        const promo = await tx.campaign.findFirst({
          where: { companyId, code, kind: CampaignKind.CODE },
        });
        if (!promo) throw new NotFoundException("Unknown voucher code");
        if (promo.maxUses != null && promo.usedCount >= promo.maxUses) {
          throw new ConflictException("This code has been fully used");
        }
        campaign = promo;
      }

      const now = new Date();
      if (!campaign.active) throw new BadRequestException("Campaign is inactive");
      if (campaign.startsAt && campaign.startsAt > now) {
        throw new BadRequestException("Campaign has not started yet");
      }
      if (campaign.endsAt && campaign.endsAt < now) {
        throw new BadRequestException("Campaign has ended");
      }
      if (order.subtotalCents < campaign.minSpendCents) {
        throw new BadRequestException(
          `Minimum spend is ${(campaign.minSpendCents / 100).toFixed(2)}`,
        );
      }

      const discountCents = this.discountFor(campaign, order.subtotalCents);
      const totals = this.recompute(order, discountCents);

      if (voucherId) {
        await tx.voucher.update({
          where: { id: voucherId },
          data: {
            status: VoucherStatus.REDEEMED,
            orderId,
            redeemedAt: now,
          },
        });
      } else {
        await tx.campaign.update({
          where: { id: campaign.id },
          data: { usedCount: { increment: 1 } },
        });
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          discountCents: totals.discountCents,
          serviceChargeCents: totals.serviceChargeCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          voucherId,
          voucherCode: code,
          appliedCampaignId: campaign.id,
          ...(memberIdToAttach ? { memberId: memberIdToAttach } : {}),
        },
        include: ORDER_INCLUDE,
      });
    });
    this.realtime.emitToOutlet(order.outletId, "order.updated", order);
    return order;
  }

  async remove(companyId: string, orderId: string) {
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, companyId },
        include: { ...ORDER_INCLUDE, outlet: true },
      });
      if (!order) throw new NotFoundException("Order not found");
      if (order.status !== OrderStatus.OPEN) {
        throw new ConflictException(`Order is ${order.status}`);
      }
      if (order.payments.some((p) => p.status === PaymentStatus.CAPTURED)) {
        throw new ConflictException("Cannot remove a voucher after payment started");
      }
      if (!order.voucherCode) throw new BadRequestException("No voucher applied");

      if (order.voucherId) {
        await tx.voucher.update({
          where: { id: order.voucherId },
          data: { status: VoucherStatus.ISSUED, orderId: null, redeemedAt: null },
        });
      } else if (order.appliedCampaignId) {
        await tx.campaign.update({
          where: { id: order.appliedCampaignId },
          data: { usedCount: { decrement: 1 } },
        });
      }

      const totals = this.recompute(order, 0);
      return tx.order.update({
        where: { id: orderId },
        data: {
          discountCents: 0,
          serviceChargeCents: totals.serviceChargeCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          voucherId: null,
          voucherCode: null,
          appliedCampaignId: null,
        },
        include: ORDER_INCLUDE,
      });
    });
    this.realtime.emitToOutlet(order.outletId, "order.updated", order);
    return order;
  }

  // ---------- internals ----------

  private discountFor(campaign: Campaign, subtotalCents: number): number {
    let discount =
      campaign.discountType === DiscountType.AMOUNT
        ? (campaign.valueCents ?? 0)
        : Math.floor((subtotalCents * (campaign.valueBps ?? 0)) / 10000);
    if (campaign.maxDiscountCents != null) {
      discount = Math.min(discount, campaign.maxDiscountCents);
    }
    return Math.min(discount, subtotalCents);
  }

  private recompute(
    order: {
      items: {
        unitPriceCents: number;
        quantity: number;
        modifiersJson: unknown;
        status: string;
      }[];
      outlet: {
        serviceChargeBps: number;
        taxBps: number;
        taxInclusive: boolean;
        serviceChargeTaxable: boolean;
        cashRounding: string;
      };
    },
    discountCents: number,
  ) {
    const lines: OrderLineInput[] = order.items
      .filter((i) => i.status !== "VOIDED")
      .map((i) => ({
        unitPriceCents: i.unitPriceCents,
        quantity: i.quantity,
        modifierDeltaCents: (
          i.modifiersJson as { priceDeltaCents: number }[]
        ).reduce((s, m) => s + m.priceDeltaCents, 0),
      }));
    return computeOrderTotals(
      lines,
      {
        serviceChargeBps: order.outlet.serviceChargeBps,
        taxBps: order.outlet.taxBps,
        taxInclusive: order.outlet.taxInclusive,
        serviceChargeTaxable: order.outlet.serviceChargeTaxable,
        cashRounding: order.outlet.cashRounding as "NONE" | "MY_5_SEN",
      },
      discountCents,
    );
  }
}
