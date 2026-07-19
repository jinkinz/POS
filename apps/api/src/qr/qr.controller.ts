import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../auth/decorators";
import { AUTH_THROTTLE } from "../auth/auth.controller";
import { QrOrderDto, QrSessionDto } from "./dto";
import { CurrentGuest, GuestSession, QrGuard } from "./qr.guard";
import { QrService } from "./qr.service";

// Customer-facing: skips the staff AuthGuard (@Public), then QrGuard
// requires a guest session token on everything except session creation.
@Public()
@Controller("qr")
export class QrController {
  constructor(private readonly qr: QrService) {}

  @Throttle(AUTH_THROTTLE)
  @Post("session")
  createSession(@Body() dto: QrSessionDto) {
    return this.qr.createSession(dto.qrToken);
  }

  @UseGuards(QrGuard)
  @Get("menu")
  menu(@CurrentGuest() guest: GuestSession) {
    return this.qr.outletMenu(guest);
  }

  @UseGuards(QrGuard)
  @Post("orders")
  placeOrder(@CurrentGuest() guest: GuestSession, @Body() dto: QrOrderDto) {
    return this.qr.placeOrder(guest, dto);
  }

  @UseGuards(QrGuard)
  @Get("orders")
  tableOrders(@CurrentGuest() guest: GuestSession) {
    return this.qr.tableOrders(guest);
  }
}
