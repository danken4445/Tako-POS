import {
  clearTenantLocalData,
  enqueueMutation,
  listLocalCategories,
  listLocalInventoryItems,
  listLocalProducts,
  listLocalSales,
  listLocalStaffMembers,
  upsertLocalCategories,
  upsertLocalInventoryItems,
  upsertLocalProducts,
  upsertLocalStaffMembers,
  withOfflineDb,
  type LocalCategory,
  type LocalInventoryItem,
  type LocalProduct,
  type LocalSale,
  type LocalStaffMember,
} from './offlineDb';
import { supabase } from '../lib/supabase';
import { updateTenantPreferences } from './tenantService';

export type TopSeller = {
  productId: string | null;
  productName: string;
  quantitySold: number;
  revenueCents: number;
  grossMarginCents: number;
  marginPercent: number;
};

export type PeriodKpi = {
  grossSalesCents: number;
  netProfitCents: number;
  totalOrders: number;
  averageOrderValueCents: number;
};

export type AdminOverview = {
  day: PeriodKpi;
  week: PeriodKpi;
  month: PeriodKpi;
  topSellers: TopSeller[];
};

export type TransactionHistoryItem = {
  id: string;
  saleId: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  costPriceCents: number;
  sellingPriceCents: number;
  grossMarginCents: number;
  createdAt: string;
};

export type TransactionHistorySale = {
  id: string;
  tenantId: string;
  cashierProfileId: string | null;
  totalCents: number;
  grossProfitCents: number;
  expensesCents: number;
  netProfitCents: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
  items: TransactionHistoryItem[];
};

export type ShiftReport = {
  id: string;
  tenantId: string;
  cashierProfileId: string | null;
  startingCashCents: number;
  totalCashSalesCents: number;
  cashRefundsCents: number;
  payInsCents: number;
  payoutsCents: number;
  expectedCashCents: number;
  actualCashCents: number;
  varianceCents: number;
  denominationBreakdown: Record<string, number>;
  paymentsSummary: Record<string, number>;
  createdAt: string;
};

export type AdminSnapshot = {
  overview: AdminOverview;
  products: LocalProduct[];
  inventoryItems: LocalInventoryItem[];
  categories: LocalCategory[];
  staffMembers: LocalStaffMember[];
  transactions: TransactionHistorySale[];
  shiftReports: ShiftReport[];
};

export type ProductInput = {
  id?: string;
  tenant_id: string;
  category_id: string | null;
  name: string;
  image_path?: string | null;
  product_image_uri?: string | null;
  price_cents: number;
  selling_price_cents: number;
  cost_price_cents: number;
  inventory_tracking: boolean;
  stock_count: number;
  linked_inventory_item_id: string | null;
  linked_inventory_item_ids: string[];
  deduction_multiplier: number;
  active: boolean;
};

export type SaveProductResult = {
  imageUploadError: string | null;
};

export type CategoryInput = {
  id?: string;
  tenant_id: string;
  name: string;
  color: string | null;
  active: boolean;
};

export type StaffInput = {
  id?: string;
  tenant_id: string;
  name: string;
  role: string;
  phone: string | null;
  pin_code: string | null;
  active: boolean;
};

export type InventoryInput = {
  id?: string;
  tenant_id: string;
  sku: string | null;
  name: string;
  quantity: number;
  unit: string | null;
};

export type BrandingInput = {
  tenantId: string;
  colorPalette: Parameters<typeof updateTenantPreferences>[1];
  logoImageUri?: string | null;
};

const createLocalId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const randomNibble = Math.floor(Math.random() * 16);
    const nibble = char === 'x' ? randomNibble : (randomNibble & 0x3) | 0x8;
    return nibble.toString(16);
  });
};

const nowIso = (): string => new Date().toISOString();

const uploadProductImage = async (tenantId: string, productId: string, imageUri: string): Promise<string> => {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }

  const response = await fetch(imageUri);
  const imageBytes = await response.arrayBuffer();
  const responseContentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const extensionMatch = imageUri.toLowerCase().match(/\.(jpg|jpeg|png|webp)(\?|$)/);
  const normalizedExt = extensionMatch?.[1] === 'jpeg' ? 'jpg' : extensionMatch?.[1];
  const extension = normalizedExt ?? (responseContentType.includes('png') ? 'png' : responseContentType.includes('webp') ? 'webp' : 'jpg');
  const contentType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
  const imagePath = `${tenantId}/products/${productId}-${Date.now()}.${extension}`;

  const { error } = await supabase.storage.from('tenant-assets').upload(imagePath, imageBytes, {
    contentType,
    upsert: true,
  });

  if (error) {
    throw new Error(error.message);
  }

  return imagePath;
};

export const resolveProductImageUrl = async (imagePath: string | null): Promise<string | null> => {
  if (!imagePath) {
    return null;
  }

  if (/^https?:\/\//i.test(imagePath)) {
    return imagePath;
  }

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.storage.from('tenant-assets').createSignedUrl(imagePath, 60 * 60 * 24);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
};

const startOfDayIso = (): string => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
};

const startOfWeekIso = (): string => {
  const now = new Date();
  const day = now.getDay();
  const delta = day === 0 ? 6 : day - 1;
  now.setDate(now.getDate() - delta);
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
};

const startOfMonthIso = (): string => {
  const now = new Date();
  now.setDate(1);
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
};

const summarizePeriod = (sales: LocalSale[]): PeriodKpi => {
  const grossSalesCents = sales.reduce((sum, sale) => sum + sale.total_cents, 0);
  const netProfitCents = sales.reduce((sum, sale) => sum + sale.net_profit_cents, 0);
  const totalOrders = sales.length;
  return {
    grossSalesCents,
    netProfitCents,
    totalOrders,
    averageOrderValueCents: totalOrders > 0 ? Math.round(grossSalesCents / totalOrders) : 0,
  };
};

export const listShiftReports = async (tenantId: string): Promise<ShiftReport[]> => {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from('shift_reports')
    .select(
      'id, tenant_id, cashier_profile_id, starting_cash_cents, total_cash_sales_cents, cash_refunds_cents, pay_ins_cents, payouts_cents, expected_cash_cents, actual_cash_cents, variance_cents, denomination_breakdown, payments_summary, created_at'
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    tenantId: row.tenant_id as string,
    cashierProfileId: (row.cashier_profile_id as string | null) ?? null,
    startingCashCents: Number(row.starting_cash_cents ?? 0),
    totalCashSalesCents: Number(row.total_cash_sales_cents ?? 0),
    cashRefundsCents: Number(row.cash_refunds_cents ?? 0),
    payInsCents: Number(row.pay_ins_cents ?? 0),
    payoutsCents: Number(row.payouts_cents ?? 0),
    expectedCashCents: Number(row.expected_cash_cents ?? 0),
    actualCashCents: Number(row.actual_cash_cents ?? 0),
    varianceCents: Number(row.variance_cents ?? 0),
    denominationBreakdown: (row.denomination_breakdown as Record<string, number>) ?? {},
    paymentsSummary: (row.payments_summary as Record<string, number>) ?? {},
    createdAt: row.created_at as string,
  }));
};

export const getAdminSnapshot = async (tenantId: string): Promise<AdminSnapshot> => {
  const [products, inventoryItems, categories, staffMembers, sales, shiftReports] = await Promise.all([
    listLocalProducts(tenantId),
    listLocalInventoryItems(tenantId),
    listLocalCategories(tenantId),
    listLocalStaffMembers(tenantId),
    listLocalSales(tenantId, 5000),
    listShiftReports(tenantId).catch(() => []),
  ]);

  const saleItems = await withOfflineDb(async (db) => {
    return db.getAllAsync<{
      id: string;
      sale_id: string;
      product_id: string | null;
      product_name: string;
      quantity: number;
      unit_price_cents: number;
      cost_price_cents: number;
      selling_price_cents: number;
      gross_margin_cents: number;
      created_at: string;
    }>(
      `
        SELECT
          i.id as id,
          i.sale_id as sale_id,
          i.product_id as product_id,
          COALESCE(p.name, 'Unlinked item') as product_name,
          i.quantity as quantity,
          i.unit_price_cents as unit_price_cents,
          i.cost_price_cents as cost_price_cents,
          i.selling_price_cents as selling_price_cents,
          i.gross_margin_cents as gross_margin_cents,
          i.created_at as created_at
        FROM local_sale_items i
        LEFT JOIN local_products p ON p.id = i.product_id
        WHERE i.tenant_id = ?
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT 20000
      `,
      [tenantId]
    );
  });

  const itemsBySaleId = saleItems.reduce<Record<string, TransactionHistoryItem[]>>((accumulator, item) => {
    const nextItem: TransactionHistoryItem = {
      id: item.id,
      saleId: item.sale_id,
      productId: item.product_id,
      productName: item.product_name,
      quantity: Number(item.quantity ?? 0),
      unitPriceCents: Number(item.unit_price_cents ?? 0),
      costPriceCents: Number(item.cost_price_cents ?? 0),
      sellingPriceCents: Number(item.selling_price_cents ?? 0),
      grossMarginCents: Number(item.gross_margin_cents ?? 0),
      createdAt: item.created_at,
    };

    if (!accumulator[nextItem.saleId]) {
      accumulator[nextItem.saleId] = [];
    }

    accumulator[nextItem.saleId].push(nextItem);
    return accumulator;
  }, {});

  const transactions = sales.map<TransactionHistorySale>((sale) => ({
    id: sale.id,
    tenantId: sale.tenant_id,
    cashierProfileId: sale.cashier_profile_id,
    totalCents: sale.total_cents,
    grossProfitCents: sale.gross_profit_cents,
    expensesCents: sale.expenses_cents,
    netProfitCents: sale.net_profit_cents,
    status: sale.status,
    createdAt: sale.created_at,
    updatedAt: sale.updated_at,
    syncedAt: sale.synced_at,
    items: itemsBySaleId[sale.id] ?? [],
  }));

  const dayStart = startOfDayIso();
  const weekStart = startOfWeekIso();
  const monthStart = startOfMonthIso();

  const completedSales = sales.filter((sale) => sale.status === 'completed');
  const daySales = completedSales.filter((sale) => sale.created_at >= dayStart);
  const weekSales = completedSales.filter((sale) => sale.created_at >= weekStart);
  const monthSales = completedSales.filter((sale) => sale.created_at >= monthStart);

  const topSellerRows = await withOfflineDb(async (db) => {
    return db.getAllAsync<{
      product_id: string | null;
      product_name: string;
      quantity_sold: number;
      revenue_cents: number;
      gross_margin_cents: number;
    }>(
      `
        SELECT
          i.product_id as product_id,
          COALESCE(p.name, 'Unlinked item') as product_name,
          SUM(i.quantity) as quantity_sold,
          SUM(i.unit_price_cents * i.quantity) as revenue_cents,
          SUM(i.gross_margin_cents * i.quantity) as gross_margin_cents
        FROM local_sale_items i
        LEFT JOIN local_products p ON p.id = i.product_id
        WHERE i.tenant_id = ?
        GROUP BY i.product_id, p.name
        ORDER BY quantity_sold DESC, gross_margin_cents DESC
        LIMIT 8
      `,
      [tenantId]
    );
  });

  const topSellers = topSellerRows.map((row) => ({
    productId: row.product_id,
    productName: row.product_name,
    quantitySold: Number(row.quantity_sold ?? 0),
    revenueCents: Number(row.revenue_cents ?? 0),
    grossMarginCents: Number(row.gross_margin_cents ?? 0),
    marginPercent: Number(row.revenue_cents) > 0 ? Math.round((Number(row.gross_margin_cents ?? 0) / Number(row.revenue_cents)) * 100) : 0,
  }));

  return {
    overview: {
      day: summarizePeriod(daySales),
      week: summarizePeriod(weekSales),
      month: summarizePeriod(monthSales),
      topSellers,
    },
    products,
    inventoryItems,
    categories,
    staffMembers,
    transactions,
    shiftReports,
  };
};

export const saveProduct = async (input: ProductInput): Promise<SaveProductResult> => {
  const timestamp = nowIso();
  const productId = input.id ?? createLocalId();
  let imagePath = input.image_path ?? null;
  let imageUploadError: string | null = null;

  if (input.product_image_uri) {
    try {
      imagePath = await uploadProductImage(input.tenant_id, productId, input.product_image_uri);
    } catch (error) {
      imageUploadError = error instanceof Error ? error.message : 'Image upload failed';
    }
  }

  const normalizedLinkedIds = Array.from(new Set(input.linked_inventory_item_ids.filter(Boolean)));
  const primaryLinkedId = normalizedLinkedIds[0] ?? input.linked_inventory_item_id ?? null;
  const product: LocalProduct = {
    id: productId,
    tenant_id: input.tenant_id,
    category_id: input.category_id,
    name: input.name,
    image_path: imagePath,
    price_cents: input.price_cents,
    selling_price_cents: input.selling_price_cents,
    cost_price_cents: input.cost_price_cents,
    inventory_tracking: input.inventory_tracking,
    stock_count: input.stock_count,
    linked_inventory_item_id: primaryLinkedId,
    linked_inventory_item_ids_json: normalizedLinkedIds.length > 0 ? JSON.stringify(normalizedLinkedIds) : null,
    deduction_multiplier: input.deduction_multiplier,
    active: input.active,
    updated_at: timestamp,
    deleted_at: null,
  };

  await upsertLocalProducts([product]);
  await enqueueMutation(input.tenant_id, 'UPSERT', 'products', product);

  return {
    imageUploadError,
  };
};

export const deleteProduct = async (tenantId: string, product: LocalProduct): Promise<void> => {
  const deletedProduct: LocalProduct = {
    ...product,
    active: false,
    updated_at: nowIso(),
    deleted_at: nowIso(),
  };

  await upsertLocalProducts([deletedProduct]);
  await enqueueMutation(tenantId, 'UPSERT', 'products', deletedProduct);
};

export const saveCategory = async (input: CategoryInput): Promise<void> => {
  const timestamp = nowIso();
  const category: LocalCategory = {
    id: input.id ?? createLocalId(),
    tenant_id: input.tenant_id,
    name: input.name,
    color: input.color,
    active: input.active,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
  };

  await upsertLocalCategories([category]);
  await enqueueMutation(input.tenant_id, 'UPSERT', 'categories', category);
};

export const deleteCategory = async (tenantId: string, category: LocalCategory): Promise<void> => {
  const deletedCategory: LocalCategory = {
    ...category,
    active: false,
    updated_at: nowIso(),
    deleted_at: nowIso(),
  };

  await upsertLocalCategories([deletedCategory]);
  await enqueueMutation(tenantId, 'UPSERT', 'categories', deletedCategory);
};

export const saveStaffMember = async (input: StaffInput): Promise<void> => {
  const timestamp = nowIso();
  const staffMember: LocalStaffMember = {
    id: input.id ?? createLocalId(),
    tenant_id: input.tenant_id,
    name: input.name,
    role: input.role,
    phone: input.phone,
    pin_code: input.pin_code,
    active: input.active,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
  };

  await upsertLocalStaffMembers([staffMember]);
  await enqueueMutation(input.tenant_id, 'UPSERT', 'staff_members', staffMember);
};

export const saveInventoryItem = async (input: InventoryInput): Promise<void> => {
  const item: LocalInventoryItem = {
    id: input.id ?? createLocalId(),
    tenant_id: input.tenant_id,
    sku: input.sku,
    name: input.name,
    quantity: input.quantity,
    unit: input.unit,
    updated_at: nowIso(),
    deleted_at: null,
  };

  await upsertLocalInventoryItems([item]);
  await enqueueMutation(input.tenant_id, 'UPSERT', 'inventory_items', item);
};

export const deleteInventoryItem = async (tenantId: string, item: LocalInventoryItem): Promise<void> => {
  const deletedItem: LocalInventoryItem = {
    ...item,
    updated_at: nowIso(),
    deleted_at: nowIso(),
  };

  await upsertLocalInventoryItems([deletedItem]);
  await enqueueMutation(tenantId, 'UPSERT', 'inventory_items', deletedItem);
};

export const deleteStaffMember = async (tenantId: string, staffMember: LocalStaffMember): Promise<void> => {
  const deletedStaff: LocalStaffMember = {
    ...staffMember,
    active: false,
    updated_at: nowIso(),
    deleted_at: nowIso(),
  };

  await upsertLocalStaffMembers([deletedStaff]);
  await enqueueMutation(tenantId, 'UPSERT', 'staff_members', deletedStaff);
};

export const saveBranding = async (input: BrandingInput) => {
  return updateTenantPreferences(input.tenantId, input.colorPalette, input.logoImageUri ?? null);
};

const clearTenantRemoteData = async (tenantId: string): Promise<void> => {
  if (!supabase) {
    return;
  }

  const rpcResult = await supabase.rpc('clear_tenant_data', { target_tenant_id: tenantId });
  if (!rpcResult.error) {
    return;
  }

  const directDeletes = [
    'shift_reports',
    'sale_items',
    'sales',
    'product_inventory_links',
    'products',
    'inventory_items',
    'categories',
    'staff_members',
  ] as const;

  const rpcErrorMessage = rpcResult.error.message.toLowerCase();
  const shouldFallback =
    rpcErrorMessage.includes('schema cache') ||
    rpcErrorMessage.includes('could not find the function') ||
    rpcErrorMessage.includes('does not exist') ||
    rpcErrorMessage.includes('undefined function');

  if (!shouldFallback) {
    throw new Error(rpcResult.error.message);
  }

  for (const tableName of directDeletes) {
    const { error } = await supabase.from(tableName).delete().eq('tenant_id', tenantId);
    if (error) {
      throw new Error(error.message);
    }
  }
};

export const clearTenantData = async (tenantId: string): Promise<void> => {
  await clearTenantRemoteData(tenantId);

  await clearTenantLocalData(tenantId);
};
