import { enqueueMutation, listLocalCategories, listLocalInventoryItems, listLocalProducts, listLocalSales, listLocalStaffMembers, type LocalCategory, type LocalInventoryItem, type LocalProduct, type LocalSale, type LocalStaffMember, upsertLocalCategories, upsertLocalInventoryItems, upsertLocalProducts, upsertLocalStaffMembers, withOfflineDb } from './offlineDb';
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

export type AdminSnapshot = {
  overview: AdminOverview;
  products: LocalProduct[];
  inventoryItems: LocalInventoryItem[];
  categories: LocalCategory[];
  staffMembers: LocalStaffMember[];
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

const createLocalId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const nowIso = (): string => new Date().toISOString();

const uploadProductImage = async (tenantId: string, productId: string, imageUri: string): Promise<string> => {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }

  const response = await fetch(imageUri);
  const blob = await response.blob();
  const extensionMatch = imageUri.toLowerCase().match(/\.(jpg|jpeg|png|webp)(\?|$)/);
  const extension = extensionMatch?.[1] === 'jpeg' ? 'jpg' : (extensionMatch?.[1] ?? 'jpg');
  const contentType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
  const imagePath = `${tenantId}/products/${productId}-${Date.now()}.${extension}`;

  const { error } = await supabase.storage.from('tenant-assets').upload(imagePath, blob, {
    contentType,
    upsert: true,
  });

  if (error) {
    throw new Error(error.message);
  }

  return imagePath;
};

export const resolveProductImageUrl = async (imagePath: string | null): Promise<string | null> => {
  if (!supabase || !imagePath) {
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

export const getAdminSnapshot = async (tenantId: string): Promise<AdminSnapshot> => {
  const [products, inventoryItems, categories, staffMembers, sales] = await Promise.all([
    listLocalProducts(tenantId),
    listLocalInventoryItems(tenantId),
    listLocalCategories(tenantId),
    listLocalStaffMembers(tenantId),
    listLocalSales(tenantId, 5000),
  ]);

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
  };
};

export const saveProduct = async (input: ProductInput): Promise<void> => {
  const timestamp = nowIso();
  const productId = input.id ?? createLocalId();
  const imagePath = input.product_image_uri
    ? await uploadProductImage(input.tenant_id, productId, input.product_image_uri)
    : (input.image_path ?? null);
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
