import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

/** Payload of a customer QR session token — no staff identity, one table. */
export interface GuestSession {
  kind: "guest";
  companyId: string;
  outletId: string;
  tableId: string;
}

/**
 * Guards customer-facing QR routes. These are marked @Public so the global
 * staff AuthGuard skips them; this guard then requires a valid guest token.
 */
@Injectable()
export class QrGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers["authorization"];
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException("Missing session token");
    try {
      const payload = await this.jwt.verifyAsync<GuestSession>(token);
      if (payload.kind !== "guest") throw new Error("not a guest token");
      request.guest = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired session");
    }
  }
}

export const CurrentGuest = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): GuestSession =>
    ctx.switchToHttp().getRequest().guest,
);
