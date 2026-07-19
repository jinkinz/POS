import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from "class-validator";
import { Throttle } from "@nestjs/throttler";
import { DeviceKind, StaffRole } from "@pos/db";
import { AuthService } from "./auth.service";
import { AuthUser, CurrentUser, Public, Roles } from "./decorators";

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class PinLoginDto {
  @Matches(/^\d{4,6}$/, { message: "PIN must be 4-6 digits" })
  pin!: string;
}

class RegisterDeviceDto {
  @IsString()
  outletId!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsEnum(DeviceKind)
  kind!: DeviceKind;
}

class CreateStaffDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEnum(StaffRole)
  role!: StaffRole;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @Matches(/^\d{4,6}$/, { message: "PIN must be 4-6 digits" })
  pin?: string;
}

export const AUTH_THROTTLE = {
  default: {
    limit: Number(process.env.THROTTLE_AUTH_LIMIT ?? 30),
    ttl: 60_000,
  },
};

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post("auth/login")
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post("auth/pin-login")
  pinLogin(
    @Headers("x-device-token") deviceToken: string | undefined,
    @Body() dto: PinLoginDto,
  ) {
    return this.auth.pinLogin(deviceToken, dto.pin);
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Post("devices")
  registerDevice(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceDto) {
    return this.auth.registerDevice(user, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Get("devices")
  listDevices(@CurrentUser() user: AuthUser) {
    return this.auth.listDevices(user);
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Post("devices/:id/revoke")
  revokeDevice(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.auth.revokeDevice(user, id);
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Post("staff")
  createStaff(@CurrentUser() user: AuthUser, @Body() dto: CreateStaffDto) {
    return this.auth.createStaff(user, dto);
  }
}
