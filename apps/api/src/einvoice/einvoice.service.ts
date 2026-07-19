import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Company, EInvoiceStatus, EInvoiceType, Prisma } from "@pos/db";
import { PrismaService } from "../prisma.service";
import { MockEInvoiceProvider } from "./mock.provider";
import { MyInvoisProvider } from "./myinvois.provider";
import { EInvoiceProvider } from "./provider.interface";

/** LHDN's designated buyer TIN for consolidated B2C e-invoices. */
const GENERAL_PUBLIC_TIN = "EI00000000010";

export interface BuyerInput {
  name: string;
  tin: string;
  idType: "NRIC" | "BRN" | "PASSPORT" | "ARMY";
  idValue: string;
  email?: string;
  phone?: string;
  address?: string;
}

@Injectable()
export class EInvoiceService {
  private readonly providers = new Map<string, EInvoiceProvider>();

  constructor(private readonly prisma: PrismaService) {
    const isProd = process.env.NODE_ENV === "production";
    const mockEnabled = process.env.MOCK_EINVOICE_ENABLED
      ? process.env.MOCK_EINVOICE_ENABLED === "true"
      : !isProd;
    if (mockEnabled) {
      const mock = new MockEInvoiceProvider();
      this.providers.set(mock.name, mock);
    }
    if (process.env.MYINVOIS_CLIENT_ID && process.env.MYINVOIS_CLIENT_SECRET) {
      const real = new MyInvoisProvider(
        process.env.MYINVOIS_CLIENT_ID,
        process.env.MYINVOIS_CLIENT_SECRET,
        process.env.MYINVOIS_SANDBOX !== "false",
      );
      this.providers.set(real.name, real);
    }
  }

  // ---------- profile ----------

  async getProfile(companyId: string) {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
    });
    return {
      name: company.name,
      tin: company.tin,
      brn: company.brn,
      sstNo: company.sstNo,
      msicCode: company.msicCode,
      invoiceAddress: company.invoiceAddress,
      providers: [...this.providers.keys()],
    };
  }

  async updateProfile(
    companyId: string,
    dto: {
      tin?: string;
      brn?: string;
      sstNo?: string;
      msicCode?: string;
      invoiceAddress?: string;
    },
  ) {
    await this.prisma.company.update({ where: { id: companyId }, data: { ...dto } });
    return this.getProfile(companyId);
  }

  // ---------- individual (buyer-requested) ----------

  async submitIndividual(companyId: string, orderId: string, buyer: BuyerInput) {
    const company = await this.requireProfile(companyId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
      include: {
        items: { orderBy: { createdAt: "asc" } },
        outlet: true,
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== "COMPLETED") {
      throw new ConflictException("Only completed orders can be e-invoiced");
    }
    const dup = await this.prisma.eInvoice.findUnique({ where: { orderId } });
    if (dup) throw new ConflictException("Order already has an e-invoice");

    const id = randomUUID();
    const doc = this.buildIndividualDoc(company, order, buyer, id);
    const provider = this.pickProvider();
    const result = await provider.submit(doc, id);

    return this.prisma.eInvoice.create({
      data: {
        id,
        companyId,
        type: EInvoiceType.INDIVIDUAL,
        status: result.status as EInvoiceStatus,
        provider: provider.name,
        orderId,
        subtotalCents: order.subtotalCents + order.serviceChargeCents,
        taxCents: order.taxCents,
        totalCents: order.totalCents + order.roundingCents,
        currency: company.currency,
        buyerJson: buyer as unknown as Prisma.InputJsonValue,
        docJson: doc as unknown as Prisma.InputJsonValue,
        providerUuid: result.providerUuid,
        longId: result.longId,
        qrUrl: result.qrUrl,
        submittedAt: new Date(),
      },
    });
  }

  // ---------- consolidated (monthly B2C) ----------

  async previewConsolidated(companyId: string, month: string) {
    const { start, end } = monthWindow(month);
    const { orders, excluded } = await this.consolidatableOrders(companyId, start, end);
    return {
      month,
      orderCount: orders.length,
      excludedIndividuallyInvoiced: excluded,
      subtotalCents: orders.reduce(
        (s, o) => s + o.subtotalCents + o.serviceChargeCents,
        0,
      ),
      taxCents: orders.reduce((s, o) => s + o.taxCents, 0),
      totalCents: orders.reduce((s, o) => s + o.totalCents + o.roundingCents, 0),
    };
  }

  async submitConsolidated(companyId: string, month: string) {
    const company = await this.requireProfile(companyId);
    const { start, end } = monthWindow(month);
    const dup = await this.prisma.eInvoice.findFirst({
      where: { companyId, type: EInvoiceType.CONSOLIDATED, periodStart: start },
    });
    if (dup) throw new ConflictException(`Consolidated e-invoice for ${month} already exists`);

    const { orders } = await this.consolidatableOrders(companyId, start, end);
    if (orders.length === 0) {
      throw new BadRequestException("No consolidatable orders in this period");
    }

    const id = randomUUID();
    const doc = this.buildConsolidatedDoc(company, orders, month, id);
    const provider = this.pickProvider();
    const result = await provider.submit(doc, id);

    return this.prisma.eInvoice.create({
      data: {
        id,
        companyId,
        type: EInvoiceType.CONSOLIDATED,
        status: result.status as EInvoiceStatus,
        provider: provider.name,
        periodStart: start,
        periodEnd: end,
        orderCount: orders.length,
        subtotalCents: orders.reduce(
          (s, o) => s + o.subtotalCents + o.serviceChargeCents,
          0,
        ),
        taxCents: orders.reduce((s, o) => s + o.taxCents, 0),
        totalCents: orders.reduce((s, o) => s + o.totalCents + o.roundingCents, 0),
        currency: company.currency,
        buyerJson: { name: "General Public", tin: GENERAL_PUBLIC_TIN },
        docJson: doc as unknown as Prisma.InputJsonValue,
        providerUuid: result.providerUuid,
        longId: result.longId,
        qrUrl: result.qrUrl,
        submittedAt: new Date(),
      },
    });
  }

  // ---------- list / refresh ----------

  list(companyId: string) {
    return this.prisma.eInvoice.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        status: true,
        provider: true,
        orderId: true,
        periodStart: true,
        periodEnd: true,
        orderCount: true,
        totalCents: true,
        taxCents: true,
        currency: true,
        longId: true,
        qrUrl: true,
        error: true,
        createdAt: true,
        validatedAt: true,
      },
    });
  }

  async refresh(companyId: string, id: string) {
    const invoice = await this.prisma.eInvoice.findFirst({
      where: { id, companyId },
    });
    if (!invoice) throw new NotFoundException("E-invoice not found");
    if (!invoice.providerUuid || invoice.status === EInvoiceStatus.VALID) {
      return invoice;
    }
    const provider = this.providers.get(invoice.provider);
    if (!provider) throw new BadRequestException("Provider not available");
    const status = await provider.getStatus(invoice.providerUuid);
    return this.prisma.eInvoice.update({
      where: { id },
      data: {
        status: status.status as EInvoiceStatus,
        longId: status.longId ?? invoice.longId,
        qrUrl: status.qrUrl ?? invoice.qrUrl,
        error: status.error,
        validatedAt: status.status === "VALID" ? new Date() : null,
      },
    });
  }

  // ---------- internals ----------

  private pickProvider(): EInvoiceProvider {
    const provider =
      this.providers.get("MYINVOIS") ?? this.providers.get("MOCK");
    if (!provider) {
      throw new BadRequestException(
        "No e-invoice provider configured (set MYINVOIS_CLIENT_ID/SECRET)",
      );
    }
    return provider;
  }

  private async requireProfile(companyId: string): Promise<Company> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
    });
    if (!company.tin || !company.brn) {
      throw new BadRequestException(
        "Company TIN and BRN must be set in the e-invoice profile first",
      );
    }
    return company;
  }

  private async consolidatableOrders(companyId: string, start: Date, end: Date) {
    const [orders, invoicedOrders] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          companyId,
          status: "COMPLETED",
          closedAt: { gte: start, lt: end },
        },
        select: {
          id: true,
          orderNo: true,
          subtotalCents: true,
          serviceChargeCents: true,
          taxCents: true,
          totalCents: true,
          roundingCents: true,
          outletId: true,
        },
      }),
      this.prisma.eInvoice.findMany({
        where: { companyId, type: EInvoiceType.INDIVIDUAL, orderId: { not: null } },
        select: { orderId: true },
      }),
    ]);
    const invoiced = new Set(invoicedOrders.map((e) => e.orderId));
    const eligible = orders.filter((o) => !invoiced.has(o.id));
    return { orders: eligible, excluded: orders.length - eligible.length };
  }

  private supplierParty(company: Company) {
    return {
      name: company.name,
      tin: company.tin,
      brn: company.brn,
      sstRegistration: company.sstNo ?? "NA",
      msicCode: company.msicCode ?? "56103", // restaurants & eating places
      address: company.invoiceAddress ?? "",
    };
  }

  /** UBL-flavoured invoice document (see MyInvois SDK for the full mapping). */
  private buildIndividualDoc(
    company: Company,
    order: {
      orderNo: number | null;
      openedAt: Date;
      subtotalCents: number;
      serviceChargeCents: number;
      taxCents: number;
      totalCents: number;
      roundingCents: number;
      items: {
        nameSnapshot: string;
        quantity: number;
        unitPriceCents: number;
        modifiersJson: Prisma.JsonValue;
        status: string;
      }[];
      outlet: { name: string };
    },
    buyer: BuyerInput,
    internalId: string,
  ) {
    const rm = (c: number) => (c / 100).toFixed(2);
    return {
      invoiceTypeCode: "01", // invoice
      documentVersion: "1.0",
      eInvoiceCodeNumber: internalId,
      issueDate: new Date().toISOString(),
      currency: company.currency,
      supplier: this.supplierParty(company),
      buyer: {
        name: buyer.name,
        tin: buyer.tin,
        idType: buyer.idType,
        idValue: buyer.idValue,
        email: buyer.email ?? null,
        phone: buyer.phone ?? null,
        address: buyer.address ?? "",
      },
      references: { receiptNo: order.orderNo, outlet: order.outlet.name },
      lines: order.items
        .filter((i) => i.status !== "VOIDED")
        .map((i, idx) => {
          const mods = (i.modifiersJson as { priceDeltaCents: number }[]).reduce(
            (s, m) => s + m.priceDeltaCents,
            0,
          );
          return {
            id: idx + 1,
            classification: "022", // food & beverage
            description: i.nameSnapshot,
            quantity: i.quantity,
            unitPrice: rm(i.unitPriceCents + mods),
            amount: rm((i.unitPriceCents + mods) * i.quantity),
          };
        }),
      serviceCharge: rm(order.serviceChargeCents),
      taxTotal: { taxType: "02", taxAmount: rm(order.taxCents) }, // service tax
      roundingAmount: rm(order.roundingCents),
      totalPayableAmount: rm(order.totalCents + order.roundingCents),
    };
  }

  private buildConsolidatedDoc(
    company: Company,
    orders: {
      orderNo: number | null;
      subtotalCents: number;
      serviceChargeCents: number;
      taxCents: number;
      totalCents: number;
      roundingCents: number;
    }[],
    month: string,
    internalId: string,
  ) {
    const rm = (c: number) => (c / 100).toFixed(2);
    const receiptNos = orders
      .map((o) => o.orderNo)
      .filter((n): n is number => n != null);
    return {
      invoiceTypeCode: "01",
      documentVersion: "1.0",
      eInvoiceCodeNumber: internalId,
      issueDate: new Date().toISOString(),
      currency: company.currency,
      supplier: this.supplierParty(company),
      buyer: {
        name: "General Public",
        tin: GENERAL_PUBLIC_TIN,
        idType: "BRN",
        idValue: "NA",
        address: "NA",
      },
      period: month,
      lines: [
        {
          id: 1,
          classification: "022",
          description: `Consolidated F&B sales ${month} (receipts #${Math.min(...receiptNos, 0)}–#${Math.max(...receiptNos, 0)}, ${orders.length} transactions)`,
          quantity: 1,
          unitPrice: rm(
            orders.reduce((s, o) => s + o.subtotalCents + o.serviceChargeCents, 0),
          ),
          amount: rm(
            orders.reduce((s, o) => s + o.subtotalCents + o.serviceChargeCents, 0),
          ),
        },
      ],
      taxTotal: {
        taxType: "02",
        taxAmount: rm(orders.reduce((s, o) => s + o.taxCents, 0)),
      },
      totalPayableAmount: rm(
        orders.reduce((s, o) => s + o.totalCents + o.roundingCents, 0),
      ),
    };
  }
}

/** "YYYY-MM" -> [start, end) in Malaysia time (fixed UTC+8, no DST). */
function monthWindow(month: string): { start: Date; end: Date } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new BadRequestException("month must be YYYY-MM");
  }
  const [y, m] = month.split("-").map(Number) as [number, number];
  const start = new Date(`${month}-01T00:00:00+08:00`);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const end = new Date(`${next}-01T00:00:00+08:00`);
  return { start, end };
}
