import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from "@nestjs/common";
import type { StaffRole } from "@pos/db";

export const IS_PUBLIC_KEY = "isPublic";
/** Skips authentication for this route (login endpoints, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = "roles";
/** Restricts a route to the given roles. Without it, any staff session passes. */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

/** JWT payload attached to the request by AuthGuard. */
export interface AuthUser {
  staffId: string;
  companyId: string;
  role: StaffRole;
  /** Present on device (PIN) sessions — the outlet the device is registered to. */
  outletId?: string;
  deviceId?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
