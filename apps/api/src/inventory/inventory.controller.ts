import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { StaffRole } from "@pos/db";
import { AuthUser, CurrentUser, Roles } from "../auth/decorators";
import {
  AdjustStockDto,
  CreateIngredientDto,
  LowThresholdDto,
  MovementsQueryDto,
  ReceiveStockDto,
  SetRecipeDto,
  StocktakeDto,
  UpdateIngredientDto,
  WastageDto,
} from "./dto";
import { InventoryService } from "./inventory.service";

@Roles(StaffRole.OWNER, StaffRole.MANAGER)
@Controller("admin")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Post("ingredients")
  createIngredient(@CurrentUser() user: AuthUser, @Body() dto: CreateIngredientDto) {
    return this.inventory.createIngredient(user.companyId, dto);
  }

  @Patch("ingredients/:id")
  updateIngredient(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateIngredientDto,
  ) {
    return this.inventory.updateIngredient(user.companyId, id, dto);
  }

  @Get("products/:id/recipe")
  getRecipe(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.inventory.getProductRecipe(user.companyId, id);
  }

  @Put("products/:id/recipe")
  setRecipe(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetRecipeDto,
  ) {
    return this.inventory.setProductRecipe(user.companyId, id, dto.items);
  }

  @Put("modifiers/:id/recipe")
  setModifierRecipe(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetRecipeDto,
  ) {
    return this.inventory.setModifierRecipe(user.companyId, id, dto.items);
  }

  @Get("outlets/:outletId/stock")
  outletStock(
    @CurrentUser() user: AuthUser,
    @Param("outletId", ParseUUIDPipe) outletId: string,
  ) {
    return this.inventory.outletStock(user.companyId, outletId);
  }

  @Post("outlets/:outletId/stock/receive")
  receive(
    @CurrentUser() user: AuthUser,
    @Param("outletId", ParseUUIDPipe) outletId: string,
    @Body() dto: ReceiveStockDto,
  ) {
    return this.inventory.receive(user.companyId, outletId, user.staffId, dto);
  }

  @Post("outlets/:outletId/stock/adjust")
  adjust(
    @CurrentUser() user: AuthUser,
    @Param("outletId", ParseUUIDPipe) outletId: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.inventory.adjust(user.companyId, outletId, user.staffId, dto);
  }

  @Post("outlets/:outletId/stock/wastage")
  wastage(
    @CurrentUser() user: AuthUser,
    @Param("outletId", ParseUUIDPipe) outletId: string,
    @Body() dto: WastageDto,
  ) {
    return this.inventory.wastage(user.companyId, outletId, user.staffId, dto);
  }

  @Post("outlets/:outletId/stocktake")
  stocktake(
    @CurrentUser() user: AuthUser,
    @Param("outletId", ParseUUIDPipe) outletId: string,
    @Body() dto: StocktakeDto,
  ) {
    return this.inventory.stocktake(user.companyId, outletId, user.staffId, dto.counts);
  }

  @Post("outlets/:outletId/stock/low-threshold")
  lowThreshold(
    @CurrentUser() user: AuthUser,
    @Param("outletId", ParseUUIDPipe) outletId: string,
    @Body() dto: LowThresholdDto,
  ) {
    return this.inventory.setLowThreshold(user.companyId, outletId, {
      ingredientId: dto.ingredientId,
      lowThresholdQty: dto.lowThresholdQty ?? null,
    });
  }

  @Get("outlets/:outletId/stock/movements")
  movements(
    @CurrentUser() user: AuthUser,
    @Param("outletId", ParseUUIDPipe) outletId: string,
    @Query() query: MovementsQueryDto,
  ) {
    return this.inventory.movements(
      user.companyId,
      outletId,
      query.ingredientId,
      query.days ?? 7,
    );
  }
}
