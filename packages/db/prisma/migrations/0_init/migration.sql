-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Country" AS ENUM ('MY', 'SG');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('MYR', 'SGD');

-- CreateEnum
CREATE TYPE "CashRounding" AS ENUM ('NONE', 'MY_5_SEN');

-- CreateEnum
CREATE TYPE "SalaryType" AS ENUM ('MONTHLY', 'HOURLY');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN');

-- CreateEnum
CREATE TYPE "DeviceKind" AS ENUM ('POS', 'KDS', 'PRINT_BRIDGE', 'AGGREGATOR');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'PAID');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DINE_IN', 'TAKEAWAY', 'PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('POS', 'QR', 'KIOSK', 'AGGREGATOR');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('PENDING', 'PREPARING', 'READY', 'SERVED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'QR_WALLET', 'GIFT_CARD', 'STORED_VALUE', 'POINTS', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CAPTURED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "IngredientUnit" AS ENUM ('G', 'ML', 'PCS');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'SALE_DEDUCT', 'VOID_RETURN', 'ADJUSTMENT', 'WASTAGE', 'STOCKTAKE');

-- CreateEnum
CREATE TYPE "GatewayPaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CampaignKind" AS ENUM ('CODE', 'ISSUED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('AMOUNT', 'PERCENT');

-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('ISSUED', 'REDEEMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PointsTxType" AS ENUM ('EARN', 'REDEEM', 'ADJUST');

-- CreateEnum
CREATE TYPE "EInvoiceType" AS ENUM ('INDIVIDUAL', 'CONSOLIDATED');

-- CreateEnum
CREATE TYPE "EInvoiceStatus" AS ENUM ('PENDING', 'SUBMITTED', 'VALID', 'INVALID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrintJobType" AS ENUM ('RECEIPT', 'KITCHEN', 'Z_REPORT');

-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'PRINTED', 'FAILED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('CASH_IN', 'CASH_OUT');

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country" "Country" NOT NULL,
    "currency" "Currency" NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loyaltyEarnPerCurrencyUnit" INTEGER NOT NULL DEFAULT 1,
    "loyaltyRedeemCentsPerPoint" INTEGER NOT NULL DEFAULT 1,
    "tin" TEXT,
    "brn" TEXT,
    "sstNo" TEXT,
    "msicCode" TEXT,
    "invoiceAddress" TEXT,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outlet" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "serviceChargeBps" INTEGER NOT NULL DEFAULT 0,
    "taxBps" INTEGER NOT NULL DEFAULT 0,
    "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "serviceChargeTaxable" BOOLEAN NOT NULL DEFAULT true,
    "cashRounding" "CashRounding" NOT NULL DEFAULT 'NONE',

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" "StaffRole" NOT NULL,
    "passwordHash" TEXT,
    "pinHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "salaryType" "SalaryType",
    "monthlySalaryCents" INTEGER,
    "hourlyRateCents" INTEGER,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "outletId" UUID NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "manual" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollItem" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "staffName" TEXT NOT NULL,
    "salaryType" "SalaryType" NOT NULL,
    "hoursWorked" DECIMAL(8,2),
    "grossCents" INTEGER NOT NULL,
    "epfEmployeeCents" INTEGER NOT NULL,
    "epfEmployerCents" INTEGER NOT NULL,
    "socsoEmployeeCents" INTEGER NOT NULL,
    "socsoEmployerCents" INTEGER NOT NULL,
    "eisEmployeeCents" INTEGER NOT NULL,
    "eisEmployerCents" INTEGER NOT NULL,
    "pcbCents" INTEGER NOT NULL DEFAULT 0,
    "netCents" INTEGER NOT NULL,

    CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "outletId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DeviceKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "categoryId" UUID,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "basePriceCents" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "kitchenStation" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "soldOut" BOOLEAN NOT NULL DEFAULT false,
    "trackStock" BOOLEAN NOT NULL DEFAULT false,
    "consignorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductStock" (
    "outletId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "onHandQty" INTEGER NOT NULL DEFAULT 0,
    "lowThresholdQty" INTEGER,

    CONSTRAINT "ProductStock_pkey" PRIMARY KEY ("outletId","productId")
);

-- CreateTable
CREATE TABLE "ProductStockMovement" (
    "id" UUID NOT NULL,
    "outletId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "qtyDelta" INTEGER NOT NULL,
    "reason" TEXT,
    "refId" UUID,
    "staffId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consignor" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "commissionBps" INTEGER NOT NULL DEFAULT 2000,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consignor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsignmentSettlement" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "consignorId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "unitsSold" INTEGER NOT NULL,
    "salesCents" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "payoutCents" INTEGER NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "ConsignmentSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierGroup" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Modifier" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priceDeltaCents" INTEGER NOT NULL DEFAULT 0,
    "soldOut" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Modifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductModifierGroup" (
    "productId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductModifierGroup_pkey" PRIMARY KEY ("productId","groupId")
);

-- CreateTable
CREATE TABLE "DiningTable" (
    "id" UUID NOT NULL,
    "outletId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "zone" TEXT,
    "seats" INTEGER NOT NULL DEFAULT 2,
    "qrToken" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DiningTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "outletId" UUID NOT NULL,
    "tableId" UUID,
    "staffId" UUID,
    "memberId" UUID,
    "orderNo" INTEGER,
    "type" "OrderType" NOT NULL,
    "source" "OrderSource" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'OPEN',
    "guestCount" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "serviceChargeCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "roundingCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "voucherId" UUID,
    "voucherCode" TEXT,
    "appliedCampaignId" UUID,
    "aggregatorProvider" TEXT,
    "externalRef" TEXT,
    "customerName" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID,
    "nameSnapshot" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "modifiersJson" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'PENDING',
    "courseNo" INTEGER NOT NULL DEFAULT 1,
    "station" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCounter" (
    "outletId" UUID NOT NULL,
    "bizDate" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderCounter_pkey" PRIMARY KEY ("outletId","bizDate")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "tenderedCents" INTEGER,
    "changeCents" INTEGER,
    "gatewayRef" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CAPTURED',
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "IngredientUnit" NOT NULL,
    "costCents" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutletIngredient" (
    "outletId" UUID NOT NULL,
    "ingredientId" UUID NOT NULL,
    "onHandQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "lowThresholdQty" DECIMAL(14,3),

    CONSTRAINT "OutletIngredient_pkey" PRIMARY KEY ("outletId","ingredientId")
);

-- CreateTable
CREATE TABLE "RecipeItem" (
    "productId" UUID NOT NULL,
    "ingredientId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "RecipeItem_pkey" PRIMARY KEY ("productId","ingredientId")
);

-- CreateTable
CREATE TABLE "ModifierRecipeItem" (
    "modifierId" UUID NOT NULL,
    "ingredientId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "ModifierRecipeItem_pkey" PRIMARY KEY ("modifierId","ingredientId")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "outletId" UUID NOT NULL,
    "ingredientId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "qtyDelta" DECIMAL(14,3) NOT NULL,
    "reason" TEXT,
    "refId" UUID,
    "staffId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayPayment" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "outletId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "GatewayPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "qrData" TEXT,
    "checkoutUrl" TEXT,
    "failReason" TEXT,
    "paymentId" UUID,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatewayPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "consentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeSpendCents" INTEGER NOT NULL DEFAULT 0,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "lastVisitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CampaignKind" NOT NULL,
    "code" TEXT,
    "discountType" "DiscountType" NOT NULL,
    "valueCents" INTEGER,
    "valueBps" INTEGER,
    "maxDiscountCents" INTEGER,
    "minSpendCents" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "memberId" UUID,
    "code" TEXT NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'ISSUED',
    "orderId" UUID,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsTransaction" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "type" "PointsTxType" NOT NULL,
    "points" INTEGER NOT NULL,
    "orderId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EInvoice" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "type" "EInvoiceType" NOT NULL,
    "status" "EInvoiceStatus" NOT NULL DEFAULT 'SUBMITTED',
    "provider" TEXT NOT NULL,
    "orderId" UUID,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 1,
    "buyerJson" JSONB,
    "docJson" JSONB NOT NULL,
    "providerUuid" TEXT,
    "longId" TEXT,
    "qrUrl" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),

    CONSTRAINT "EInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "outletId" UUID NOT NULL,
    "orderId" UUID,
    "type" "PrintJobType" NOT NULL,
    "station" TEXT,
    "payload" JSONB NOT NULL,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedAt" TIMESTAMP(3),

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" UUID NOT NULL,
    "outletId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "openingFloatCents" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "expectedCashCents" INTEGER,
    "countedCashCents" INTEGER,
    "notes" TEXT,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Outlet_companyId_idx" ON "Outlet"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_email_key" ON "Staff"("email");

-- CreateIndex
CREATE INDEX "Staff_companyId_idx" ON "Staff"("companyId");

-- CreateIndex
CREATE INDEX "TimeEntry_staffId_clockIn_idx" ON "TimeEntry"("staffId", "clockIn");

-- CreateIndex
CREATE INDEX "TimeEntry_outletId_clockIn_idx" ON "TimeEntry"("outletId", "clockIn");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_companyId_month_key" ON "PayrollRun"("companyId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollItem_runId_staffId_key" ON "PayrollItem"("runId", "staffId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

-- CreateIndex
CREATE INDEX "Device_companyId_idx" ON "Device"("companyId");

-- CreateIndex
CREATE INDEX "Category_companyId_idx" ON "Category"("companyId");

-- CreateIndex
CREATE INDEX "Product_companyId_categoryId_idx" ON "Product"("companyId", "categoryId");

-- CreateIndex
CREATE INDEX "Product_companyId_sku_idx" ON "Product"("companyId", "sku");

-- CreateIndex
CREATE INDEX "ProductStockMovement_outletId_productId_createdAt_idx" ON "ProductStockMovement"("outletId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "Consignor_companyId_idx" ON "Consignor"("companyId");

-- CreateIndex
CREATE INDEX "ConsignmentSettlement_companyId_idx" ON "ConsignmentSettlement"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsignmentSettlement_consignorId_periodStart_key" ON "ConsignmentSettlement"("consignorId", "periodStart");

-- CreateIndex
CREATE INDEX "ModifierGroup_companyId_idx" ON "ModifierGroup"("companyId");

-- CreateIndex
CREATE INDEX "Modifier_groupId_idx" ON "Modifier"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "DiningTable_qrToken_key" ON "DiningTable"("qrToken");

-- CreateIndex
CREATE UNIQUE INDEX "DiningTable_outletId_name_key" ON "DiningTable"("outletId", "name");

-- CreateIndex
CREATE INDEX "Order_outletId_status_idx" ON "Order"("outletId", "status");

-- CreateIndex
CREATE INDEX "Order_outletId_openedAt_idx" ON "Order"("outletId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_aggregatorProvider_externalRef_key" ON "Order"("aggregatorProvider", "externalRef");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Ingredient_companyId_idx" ON "Ingredient"("companyId");

-- CreateIndex
CREATE INDEX "StockMovement_outletId_ingredientId_createdAt_idx" ON "StockMovement"("outletId", "ingredientId", "createdAt");

-- CreateIndex
CREATE INDEX "GatewayPayment_orderId_idx" ON "GatewayPayment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayPayment_provider_providerRef_key" ON "GatewayPayment"("provider", "providerRef");

-- CreateIndex
CREATE INDEX "Member_companyId_name_idx" ON "Member"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Member_companyId_phone_key" ON "Member"("companyId", "phone");

-- CreateIndex
CREATE INDEX "Campaign_companyId_idx" ON "Campaign"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_companyId_code_key" ON "Campaign"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_code_key" ON "Voucher"("code");

-- CreateIndex
CREATE INDEX "Voucher_memberId_idx" ON "Voucher"("memberId");

-- CreateIndex
CREATE INDEX "PointsTransaction_memberId_createdAt_idx" ON "PointsTransaction"("memberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointsTransaction_orderId_type_key" ON "PointsTransaction"("orderId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "EInvoice_orderId_key" ON "EInvoice"("orderId");

-- CreateIndex
CREATE INDEX "EInvoice_companyId_createdAt_idx" ON "EInvoice"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EInvoice_companyId_type_periodStart_key" ON "EInvoice"("companyId", "type", "periodStart");

-- CreateIndex
CREATE INDEX "PrintJob_outletId_status_createdAt_idx" ON "PrintJob"("outletId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Shift_outletId_openedAt_idx" ON "Shift"("outletId", "openedAt");

-- CreateIndex
CREATE INDEX "CashMovement_shiftId_idx" ON "CashMovement"("shiftId");

-- AddForeignKey
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_consignorId_fkey" FOREIGN KEY ("consignorId") REFERENCES "Consignor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStock" ADD CONSTRAINT "ProductStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentSettlement" ADD CONSTRAINT "ConsignmentSettlement_consignorId_fkey" FOREIGN KEY ("consignorId") REFERENCES "Consignor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningTable" ADD CONSTRAINT "DiningTable_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletIngredient" ADD CONSTRAINT "OutletIngredient_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletIngredient" ADD CONSTRAINT "OutletIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierRecipeItem" ADD CONSTRAINT "ModifierRecipeItem_modifierId_fkey" FOREIGN KEY ("modifierId") REFERENCES "Modifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierRecipeItem" ADD CONSTRAINT "ModifierRecipeItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayPayment" ADD CONSTRAINT "GatewayPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsTransaction" ADD CONSTRAINT "PointsTransaction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EInvoice" ADD CONSTRAINT "EInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

