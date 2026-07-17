import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DeviceKind, StaffRole } from "@pos/db";
import { PrismaService } from "../prisma.service";
import { AuthUser } from "./decorators";
import {
  generateDeviceToken,
  hashSecret,
  hashToken,
  verifySecret,
} from "./hashing";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Back-office login with email + password. */
  async login(email: string, password: string) {
    const staff = await this.prisma.staff.findUnique({ where: { email } });
    if (!staff || !staff.active || !(await verifySecret(password, staff.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }
    return this.session({
      staffId: staff.id,
      companyId: staff.companyId,
      role: staff.role,
    }, staff.name);
  }

  /** POS/KDS unlock: registered device token + personal staff PIN. */
  async pinLogin(deviceToken: string | undefined, pin: string) {
    if (!deviceToken) {
      throw new UnauthorizedException("Missing X-Device-Token header");
    }
    const device = await this.prisma.device.findUnique({
      where: { tokenHash: hashToken(deviceToken) },
    });
    if (!device || !device.active) {
      throw new UnauthorizedException("Unknown or revoked device");
    }

    const candidates = await this.prisma.staff.findMany({
      where: { companyId: device.companyId, active: true, pinHash: { not: null } },
    });
    let match: (typeof candidates)[number] | undefined;
    for (const staff of candidates) {
      if (await verifySecret(pin, staff.pinHash)) {
        match = staff;
        break;
      }
    }
    if (!match) throw new UnauthorizedException("Invalid PIN");

    await this.prisma.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });

    return this.session({
      staffId: match.id,
      companyId: device.companyId,
      role: match.role,
      outletId: device.outletId,
      deviceId: device.id,
    }, match.name);
  }

  /** Manager registers a terminal; the returned token is shown exactly once. */
  async registerDevice(
    user: AuthUser,
    input: { outletId: string; name: string; kind: DeviceKind },
  ) {
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: input.outletId, companyId: user.companyId },
    });
    if (!outlet) throw new NotFoundException("Outlet not found");

    const token = generateDeviceToken();
    const device = await this.prisma.device.create({
      data: {
        companyId: user.companyId,
        outletId: outlet.id,
        name: input.name,
        kind: input.kind,
        tokenHash: hashToken(token),
      },
    });
    return {
      device: pickDevice(device),
      deviceToken: token,
    };
  }

  async listDevices(user: AuthUser) {
    const devices = await this.prisma.device.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: "asc" },
    });
    return devices.map(pickDevice);
  }

  async revokeDevice(user: AuthUser, deviceId: string) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, companyId: user.companyId },
    });
    if (!device) throw new NotFoundException("Device not found");
    const updated = await this.prisma.device.update({
      where: { id: deviceId },
      data: { active: false },
    });
    return pickDevice(updated);
  }

  async createStaff(
    user: AuthUser,
    input: {
      name: string;
      role: StaffRole;
      email?: string;
      phone?: string;
      password?: string;
      pin?: string;
    },
  ) {
    if (input.role === StaffRole.OWNER && user.role !== StaffRole.OWNER) {
      throw new BadRequestException("Only an owner can create another owner");
    }
    if (input.pin) {
      // PINs unlock shared terminals — duplicates within a company would make
      // logins ambiguous, so reject up front.
      const others = await this.prisma.staff.findMany({
        where: { companyId: user.companyId, active: true, pinHash: { not: null } },
      });
      for (const other of others) {
        if (await verifySecret(input.pin, other.pinHash)) {
          throw new BadRequestException("PIN already in use by another staff member");
        }
      }
    }
    const staff = await this.prisma.staff.create({
      data: {
        companyId: user.companyId,
        name: input.name,
        role: input.role,
        email: input.email,
        phone: input.phone,
        passwordHash: input.password ? await hashSecret(input.password) : null,
        pinHash: input.pin ? await hashSecret(input.pin) : null,
      },
    });
    return {
      id: staff.id,
      name: staff.name,
      role: staff.role,
      email: staff.email,
      phone: staff.phone,
    };
  }

  private async session(payload: AuthUser, staffName: string) {
    return {
      token: await this.jwt.signAsync({ ...payload }),
      staff: {
        id: payload.staffId,
        name: staffName,
        role: payload.role,
        companyId: payload.companyId,
        outletId: payload.outletId ?? null,
      },
    };
  }
}

function pickDevice(d: {
  id: string;
  outletId: string;
  name: string;
  kind: DeviceKind;
  active: boolean;
  lastSeenAt: Date | null;
}) {
  return {
    id: d.id,
    outletId: d.outletId,
    name: d.name,
    kind: d.kind,
    active: d.active,
    lastSeenAt: d.lastSeenAt,
  };
}
