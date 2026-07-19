import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { StaffRole } from "@pos/db";
import { AuthUser, CurrentUser, Roles } from "../auth/decorators";
import { AdminService } from "./admin.service";
import {
  AttachGroupDto,
  CreateCategoryDto,
  CreateModifierDto,
  CreateModifierGroupDto,
  CreateProductDto,
  CreateTableDto,
  UpdateCategoryDto,
  UpdateCompanyDto,
  UpdateModifierDto,
  UpdateModifierGroupDto,
  UpdateOutletDto,
  UpdateProductDto,
  UpdateStaffDto,
  UpdateTableDto,
} from "./dto";

@Roles(StaffRole.OWNER, StaffRole.MANAGER)
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // catalog
  @Get("catalog")
  catalog(@CurrentUser() user: AuthUser) {
    return this.admin.catalog(user.companyId);
  }

  @Post("categories")
  createCategory(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.admin.createCategory(user.companyId, dto);
  }

  @Patch("categories/:id")
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.admin.updateCategory(user.companyId, id, dto);
  }

  @Post("products")
  createProduct(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.admin.createProduct(user.companyId, dto);
  }

  @Patch("products/:id")
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.admin.updateProduct(user.companyId, id, dto);
  }

  @Post("modifier-groups")
  createModifierGroup(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateModifierGroupDto,
  ) {
    return this.admin.createModifierGroup(user.companyId, dto);
  }

  @Patch("modifier-groups/:id")
  updateModifierGroup(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateModifierGroupDto,
  ) {
    return this.admin.updateModifierGroup(user.companyId, id, dto);
  }

  @Post("modifier-groups/:id/modifiers")
  createModifier(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) groupId: string,
    @Body() dto: CreateModifierDto,
  ) {
    return this.admin.createModifier(user.companyId, groupId, dto);
  }

  @Patch("modifiers/:id")
  updateModifier(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateModifierDto,
  ) {
    return this.admin.updateModifier(user.companyId, id, dto);
  }

  @Post("products/:id/modifier-groups")
  attachGroup(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) productId: string,
    @Body() dto: AttachGroupDto,
  ) {
    return this.admin.attachGroup(user.companyId, productId, dto.groupId, dto.sortOrder);
  }

  @Delete("products/:id/modifier-groups/:groupId")
  detachGroup(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) productId: string,
    @Param("groupId", ParseUUIDPipe) groupId: string,
  ) {
    return this.admin.detachGroup(user.companyId, productId, groupId);
  }

  // company settings
  @Get("company")
  getCompany(@CurrentUser() user: AuthUser) {
    return this.admin.getCompany(user.companyId);
  }

  @Patch("company")
  updateCompany(@CurrentUser() user: AuthUser, @Body() dto: UpdateCompanyDto) {
    return this.admin.updateCompany(user.companyId, dto);
  }

  // outlets & tables
  @Get("outlets")
  listOutlets(@CurrentUser() user: AuthUser) {
    return this.admin.listOutlets(user.companyId);
  }

  @Patch("outlets/:id")
  updateOutlet(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateOutletDto,
  ) {
    return this.admin.updateOutlet(user.companyId, id, dto);
  }

  @Post("outlets/:id/tables")
  createTable(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) outletId: string,
    @Body() dto: CreateTableDto,
  ) {
    return this.admin.createTable(user.companyId, outletId, dto);
  }

  @Patch("tables/:id")
  updateTable(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateTableDto,
  ) {
    return this.admin.updateTable(user.companyId, id, dto);
  }

  // staff
  @Get("staff")
  listStaff(@CurrentUser() user: AuthUser) {
    return this.admin.listStaff(user.companyId);
  }

  @Patch("staff/:id")
  updateStaff(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.admin.updateStaff(user.companyId, id, dto);
  }

  // reports
  @Get("outlets/:id/reports/daily")
  dailyReport(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) outletId: string,
    @Query("date") date: string,
  ) {
    return this.admin.dailyReport(user.companyId, outletId, date);
  }
}
