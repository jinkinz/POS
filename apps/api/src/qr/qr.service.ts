import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { MenuService } from "../menu/menu.service";
import { OrdersService } from "../orders/orders.service";
import { PrismaService } from "../prisma.service";
import { GuestSession } from "./qr.guard";
import { QrOrderDto } from "./dto";

@Injectable()
export class QrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly menu: MenuService,
    private readonly orders: OrdersService,
  ) {}

  /** Exchange the table's printed QR token for a short-lived guest session. */
  async createSession(qrToken: string) {
    const table = await this.prisma.diningTable.findUnique({
      where: { qrToken },
      include: { outlet: { include: { company: true } } },
    });
    if (!table || !table.active || !table.outlet.active) {
      throw new NotFoundException("Table not found");
    }
    const payload: GuestSession = {
      kind: "guest",
      companyId: table.outlet.companyId,
      outletId: table.outletId,
      tableId: table.id,
    };
    const token = await this.jwt.signAsync({ ...payload }, { expiresIn: "3h" });
    return {
      token,
      table: { id: table.id, name: table.name },
      outlet: {
        id: table.outlet.id,
        name: table.outlet.name,
        currency: table.outlet.company.currency,
      },
    };
  }

  outletMenu(guest: GuestSession) {
    return this.menu.outletMenu(guest.outletId, guest.companyId);
  }

  async placeOrder(guest: GuestSession, dto: QrOrderDto) {
    const notes = dto.guestName ? `Guest: ${dto.guestName}` : undefined;
    const order = await this.orders.createOrder(
      {
        id: dto.id,
        outletId: guest.outletId,
        type: "DINE_IN",
        source: "QR",
        tableId: guest.tableId,
        guestCount: dto.guestCount ?? 1,
        notes,
        items: dto.items,
      },
      { companyId: guest.companyId, outletId: guest.outletId },
    );
    return this.publicOrder(order);
  }

  /** Everything ordered at this table recently — the shared group view. */
  async tableOrders(guest: GuestSession) {
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const orders = await this.prisma.order.findMany({
      where: {
        tableId: guest.tableId,
        outletId: guest.outletId,
        status: { not: "VOIDED" },
        openedAt: { gte: since },
      },
      orderBy: { openedAt: "desc" },
      take: 20,
      include: { items: { orderBy: { createdAt: "asc" } } },
    });
    return orders.map((o) => this.publicOrder(o));
  }

  /** Strips internals guests shouldn't see (staff ids, payments detail). */
  private publicOrder(order: {
    id: string;
    orderNo: number | null;
    status: string;
    notes: string | null;
    openedAt: Date;
    subtotalCents: number;
    serviceChargeCents: number;
    taxCents: number;
    totalCents: number;
    items: {
      id: string;
      nameSnapshot: string;
      quantity: number;
      unitPriceCents: number;
      modifiersJson: unknown;
      notes: string | null;
      status: string;
    }[];
  }) {
    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      notes: order.notes,
      openedAt: order.openedAt,
      subtotalCents: order.subtotalCents,
      serviceChargeCents: order.serviceChargeCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      items: order.items
        .filter((i) => i.status !== "VOIDED")
        .map((i) => ({
          id: i.id,
          name: i.nameSnapshot,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
          modifiers: i.modifiersJson,
          notes: i.notes,
          status: i.status,
        })),
    };
  }
}
