import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from "@nestjs/common";
import { IsBoolean } from "class-validator";
import { StaffRole } from "@pos/db";
import { AuthUser, CurrentUser, Roles } from "../auth/decorators";
import { MenuService } from "./menu.service";

class SetSoldOutDto {
  @IsBoolean()
  soldOut!: boolean;
}

@Controller()
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get("outlets/:outletId/menu")
  outletMenu(
    @CurrentUser() user: AuthUser,
    @Param("outletId", ParseUUIDPipe) outletId: string,
  ) {
    return this.menu.outletMenu(outletId, user.companyId);
  }

  @Roles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.KITCHEN)
  @Patch("products/:productId/sold-out")
  setSoldOut(
    @CurrentUser() user: AuthUser,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Body() dto: SetSoldOutDto,
  ) {
    return this.menu.setSoldOut(productId, user.companyId, dto.soldOut);
  }
}
