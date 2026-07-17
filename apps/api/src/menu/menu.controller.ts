import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from "@nestjs/common";
import { IsBoolean } from "class-validator";
import { MenuService } from "./menu.service";

class SetSoldOutDto {
  @IsBoolean()
  soldOut!: boolean;
}

@Controller()
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get("outlets/:outletId/menu")
  outletMenu(@Param("outletId", ParseUUIDPipe) outletId: string) {
    return this.menu.outletMenu(outletId);
  }

  @Patch("products/:productId/sold-out")
  setSoldOut(
    @Param("productId", ParseUUIDPipe) productId: string,
    @Body() dto: SetSoldOutDto,
  ) {
    return this.menu.setSoldOut(productId, dto.soldOut);
  }
}
