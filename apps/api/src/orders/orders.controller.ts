import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { OrderStatus, StaffRole } from "@pos/db";
import { AuthUser, CurrentUser, Roles } from "../auth/decorators";
import { AddItemsDto, CreateOrderDto, PayDto, VoidDto } from "./dto";
import { OrdersService } from "./orders.service";

const SELLING_ROLES = [
  StaffRole.OWNER,
  StaffRole.MANAGER,
  StaffRole.CASHIER,
  StaffRole.WAITER,
] as const;

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Roles(...SELLING_ROLES)
  @Post("orders")
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.createOrder(dto, user);
  }

  @Get("orders/:id")
  get(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.orders.getOrder(id, user.companyId);
  }

  @Get("outlets/:outletId/orders")
  list(
    @CurrentUser() user: AuthUser,
    @Param("outletId", ParseUUIDPipe) outletId: string,
    @Query("status") status?: OrderStatus,
  ) {
    return this.orders.listOutletOrders(outletId, user.companyId, status);
  }

  @Roles(...SELLING_ROLES)
  @Post("orders/:id/items")
  addItems(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AddItemsDto,
  ) {
    return this.orders.addItems(id, dto, user.companyId);
  }

  // Voids are manager-level actions — a cashier hands the terminal over.
  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Post("orders/:id/items/:itemId/void")
  voidItem(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Body() dto: VoidDto,
  ) {
    return this.orders.voidItem(id, itemId, dto.reason, user.companyId);
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER)
  @Post("orders/:id/void")
  voidOrder(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: VoidDto,
  ) {
    return this.orders.voidOrder(id, dto.reason, user.companyId);
  }

  @Roles(...SELLING_ROLES)
  @Post("orders/:id/payments")
  pay(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: PayDto,
  ) {
    return this.orders.pay(id, dto, user.companyId);
  }
}
