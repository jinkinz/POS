import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

/** Session payload of a headless print-bridge device. */
export interface BridgeSession {
  kind: "bridge";
  companyId: string;
  outletId: string;
  deviceId: string;
}

@Injectable()
export class BridgeGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers["authorization"];
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException("Missing bridge token");
    try {
      const payload = await this.jwt.verifyAsync<BridgeSession>(token);
      if (payload.kind !== "bridge") throw new Error("not a bridge token");
      request.bridge = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired bridge session");
    }
  }
}

export const CurrentBridge = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): BridgeSession =>
    ctx.switchToHttp().getRequest().bridge,
);
