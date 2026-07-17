import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { OrderStatus } from "@pos/db";
import { AddItemsDto, CreateOrderDto, PayDto, VoidDto } from "./dto";
import { OrdersService } from "./orders.service";

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post("orders")
  create(@Body() dto: CreateOrderDto) {
    return this.orders.createOrder(dto);
  }

  @Get("orders/:id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.orders.getOrder(id);
  }

  @Get("outlets/:outletId/orders")
  list(
    @Param("outletId", ParseUUIDPipe) outletId: string,
    @Query("status") status?: OrderStatus,
  ) {
    return this.orders.listOutletOrders(outletId, status);
  }

  @Post("orders/:id/items")
  addItems(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AddItemsDto) {
    return this.orders.addItems(id, dto);
  }

  @Post("orders/:id/items/:itemId/void")
  voidItem(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Body() dto: VoidDto,
  ) {
    return this.orders.voidItem(id, itemId, dto.reason);
  }

  @Post("orders/:id/void")
  voidOrder(@Param("id", ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.orders.voidOrder(id, dto.reason);
  }

  @Post("orders/:id/payments")
  pay(@Param("id", ParseUUIDPipe) id: string, @Body() dto: PayDto) {
    return this.orders.pay(id, dto);
  }
}
