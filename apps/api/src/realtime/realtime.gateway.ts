import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { AuthUser } from "../auth/decorators";
import { PrismaService } from "../prisma.service";

/**
 * Realtime fan-out. Clients authenticate the socket handshake with the same
 * JWT used for REST. Device sessions auto-join their outlet's room; back
 * office sessions join explicitly via "subscribe" (company-checked).
 * Events: order.created, order.updated, menu.sold_out
 */
@Injectable()
@WebSocketGateway({ namespace: "/rt", cors: { origin: true } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token: string | undefined =
        client.handshake.auth?.token ?? (client.handshake.query?.token as string);
      if (!token) throw new Error("missing token");
      const user = await this.jwt.verifyAsync<AuthUser>(token);
      client.data.user = user;
      if (user.outletId) {
        await client.join(roomFor(user.outletId));
      }
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage("subscribe")
  async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { outletId?: string },
  ) {
    const user: AuthUser | undefined = client.data.user;
    if (!user || !body?.outletId) return { ok: false };
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: body.outletId, companyId: user.companyId },
    });
    if (!outlet) return { ok: false };
    await client.join(roomFor(outlet.id));
    return { ok: true };
  }

  emitToOutlet(outletId: string, event: string, payload: unknown) {
    this.server.to(roomFor(outletId)).emit(event, payload);
  }
}

function roomFor(outletId: string): string {
  return `outlet:${outletId}`;
}
