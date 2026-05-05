import { supabase } from '../lib/supabase';
import {
  upsertLocalCategories,
  getPendingMutations,
  getSyncCursor,
  initializeOfflineDb,
  markMutationFailed,
  markMutationSynced,
  markSaleSynced,
  markShiftReportSynced,
  type LocalInventoryItem,
  type LocalCategory,
  type LocalProduct,
  type LocalStaffMember,
  upsertLocalStaffMembers,
  updateSyncCursor,
  upsertLocalInventoryItems,
  upsertLocalProducts,
  withOfflineDb,
} from './offlineDb';

type SyncableTable = 'products' | 'inventory_items' | 'sales' | 'categories' | 'staff_members' | 'shift_reports';

type SaleMutationPayload = {
  sale: {
    id: string;
    tenant_id: string;
    cashier_profile_id: string | null;
    total_cents: number;
    gross_profit_cents: number;
    expenses_cents: number;
    net_profit_cents: number;
    payment_method: string;
    status: string;
    created_at: string;
  };
  items: Array<{
    id: string;
    sale_id: string;
    product_id: string | null;
    tenant_id: string;
    quantity: number;
    unit_price_cents: number;
    cost_price_cents: number;
    selling_price_cents: number;
    gross_margin_cents: number;
    created_at: string;
  }>;
};

type ShiftReportPayload = {
  id: string;
  shift_id: string;
  tenant_id: string;
  cashier_profile_id: string | null;
  starting_cash_cents: number;
  total_cash_sales_cents: number;
  cash_refunds_cents: number;
  pay_ins_cents: number;
  payouts_cents: number;
  expected_cash_cents: number;
  actual_cash_cents: number;
  variance_cents: number;
  denomination_breakdown: Record<string, number>;
  payments_summary: Record<string, number>;
  created_at: string;
};

type ProductRow = {
  id: string;
  tenant_id: string;
  category_id: string | null;
  name: string;
  image_path: string | null;
  price_cents: number;
  selling_price_cents: number | null;
  cost_price_cents: number | null;
  inventory_tracking: boolean | null;
  stock_count: number | null;
  linked_inventory_item_id: string | null;
  deduction_multiplier: number | null;
  active: boolean;
  updated_at?: string;
  deleted_at?: string | null;
  created_at: string;
};

type ProductInventoryLinkRow = {
  tenant_id: string;
  product_id: string;
  inventory_item_id: string;
  updated_at: string;
  deleted_at: string | null;
};

type CategoryRow = {
  id: string;
  tenant_id: string;
  name: string;
  color: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type StaffRow = {
  id: string;
  tenant_id: string;
  name: string;
  role: string;
  phone: string | null;
  pin_code: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type InventoryRow = {
  id: string;
  tenant_id: string;
  sku: string | null;
  name: string;
  quantity: number;
  unit: string | null;
  updated_at: string;
  deleted_at?: string | null;
};

let syncTimer: ReturnType<typeof setInterval> | null = null;
let activeTenantId: string | null = null;
let running = false;

const SYNC_INTERVAL_MS = 8000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value: string | null | undefined): value is string => typeof value === 'string' && UUID_REGEX.test(value);

const toValidUuidOrNull = (value: string | null | undefined): string | null => (isUuid(value) ? value : null);

const assertRequiredUuid = (value: string | null | undefined, fieldName: string): string => {
  if (!isUuid(value)) {
    throw new Error(`INVALID_LOCAL_UUID:${fieldName}`);
  }

  return value;
};

const isTransientNetworkError = (errorMessage: string): boolean => {
  const normalized = errorMessage.toLowerCase();
  return (
    normalized.includes('network request failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('timeout') ||
    normalized.includes('connection')
  );
};

const isIrrecoverableMutationError = (errorMessage: string): boolean => {
  const normalized = errorMessage.toLowerCase();
  return normalized.includes('invalid_local_uuid:') || normalized.includes('invalid input syntax for type uuid');
};

const parseLinkedInventoryIds = (linkedIdsJson: string | null, fallbackLinkedId: string | null): string[] => {
  if (linkedIdsJson) {
    try {
      const parsed = JSON.parse(linkedIdsJson);
      if (Array.isArray(parsed)) {
        return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
      }
    } catch {
      // Ignore malformed local link payload and fall back to single linked ID.
    }
  }

  return fallbackLinkedId ? [fallbackLinkedId] : [];
};

const buildLinkedIdsMap = (links: ProductInventoryLinkRow[]): Map<string, string[]> => {
  const map = new Map<string, string[]>();

  for (const link of links) {
    if (link.deleted_at) {
      continue;
    }

    const current = map.get(link.product_id) ?? [];
    current.push(link.inventory_item_id);
    map.set(link.product_id, current);
  }

  return map;
};

const mergeCursor = (left: string | null, right: string | null): string | null => {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left > right ? left : right;
};



const toLocalCategory = (row: CategoryRow): LocalCategory => ({
  id: row.id,
  tenant_id: row.tenant_id,
  name: row.name,
  color: row.color,
  active: row.active,
  created_at: row.created_at,
  updated_at: row.updated_at,
  deleted_at: row.deleted_at,
});

const toLocalStaff = (row: StaffRow): LocalStaffMember => ({
  id: row.id,
  tenant_id: row.tenant_id,
  name: row.name,
  role: row.role,
  phone: row.phone,
  pin_code: row.pin_code,
  active: row.active,
  created_at: row.created_at,
  updated_at: row.updated_at,
  deleted_at: row.deleted_at,
});

const toLocalInventory = (row: InventoryRow): LocalInventoryItem => ({
  id: row.id,
  tenant_id: row.tenant_id,
  sku: row.sku,
  name: row.name,
  quantity: row.quantity,
  unit: row.unit,
  updated_at: row.updated_at,
  deleted_at: row.deleted_at ?? null,
});

const toLocalProduct = (row: ProductRow, linkedIds?: string[]): LocalProduct => ({
  id: row.id,
  tenant_id: row.tenant_id,
  category_id: row.category_id,
  name: row.name,
  image_path: row.image_path ?? null,
  price_cents: row.price_cents,
  selling_price_cents: row.selling_price_cents ?? row.price_cents,
  cost_price_cents: row.cost_price_cents ?? 0,
  inventory_tracking: row.inventory_tracking ?? true,
  stock_count: row.stock_count ?? 0,
  linked_inventory_item_id: linkedIds && linkedIds.length > 0 ? linkedIds[0] : row.linked_inventory_item_id ?? null,
  linked_inventory_item_ids_json:
    linkedIds && linkedIds.length > 0
      ? JSON.stringify(Array.from(new Set(linkedIds)))
      : row.linked_inventory_item_id
      ? JSON.stringify([row.linked_inventory_item_id])
      : null,
  deduction_multiplier: row.deduction_multiplier ?? 1,
  active: row.active,
  updated_at: row.updated_at ?? row.created_at,
  deleted_at: row.deleted_at ?? null,
});

const loadLocalDeletionMap = async (
  tableName: 'local_products' | 'local_inventory_items',
  ids: string[]
): Promise<Map<string, string>> => {
  if (ids.length === 0) {
    return new Map();
  }

  return withOfflineDb(async (db) => {
    const placeholders = ids.map(() => '?').join(',');
    const rows = await db.getAllAsync<{ id: string; deleted_at: string | null }>(
      `
        SELECT id, deleted_at
        FROM ${tableName}
        WHERE id IN (${placeholders})
          AND deleted_at IS NOT NULL
      `,
      ids
    );

    return new Map(rows.map((row) => [row.id, row.deleted_at ?? '']));
  });
};

const shouldApplyRemoteUpdate = (deletedAt: string | undefined, remoteTimestamp?: string): boolean => {
  if (!deletedAt) {
    return true;
  }

  const deletedMs = Date.parse(deletedAt);
  const remoteMs = remoteTimestamp ? Date.parse(remoteTimestamp) : Number.NaN;

  if (!Number.isFinite(deletedMs)) {
    return true;
  }

  if (!Number.isFinite(remoteMs)) {
    return false;
  }

  return remoteMs > deletedMs;
};

const pushMutation = async (tableName: string, payload: unknown): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase client unavailable.');
  }

  if (tableName === 'products') {
    const product = payload as LocalProduct;
    const productId = assertRequiredUuid(product.id, 'products.id');
    const tenantId = assertRequiredUuid(product.tenant_id, 'products.tenant_id');
    let categoryId = toValidUuidOrNull(product.category_id);
    const linkedInventoryIds = parseLinkedInventoryIds(product.linked_inventory_item_ids_json, product.linked_inventory_item_id).filter(isUuid);
    const linkedInventoryItemId = toValidUuidOrNull(product.linked_inventory_item_id);

    if (categoryId) {
      const { data: categoryRow, error: categoryError } = await supabase
        .from('categories')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('id', categoryId)
        .maybeSingle();

      if (categoryError) {
        throw new Error(categoryError.message);
      }

      if (!categoryRow) {
        categoryId = null;
      }
    }

    const { error } = await supabase.from('products').upsert(
      {
        id: productId,
        tenant_id: tenantId,
        category_id: categoryId,
        name: product.name,
        image_path: product.image_path,
        price_cents: product.price_cents,
        selling_price_cents: product.selling_price_cents,
        cost_price_cents: product.cost_price_cents,
        inventory_tracking: product.inventory_tracking,
        stock_count: product.stock_count,
        linked_inventory_item_id: linkedInventoryItemId,
        deduction_multiplier: product.deduction_multiplier,
        active: product.active,
        deleted_at: product.deleted_at ?? null,
        updated_at: product.updated_at ?? undefined,
      },
      { onConflict: 'id' }
    );

    if (error) {
      throw new Error(error.message);
    }

    const { data: existingLinks, error: linksReadError } = await supabase
      .from('product_inventory_links')
      .select('inventory_item_id, deleted_at')
      .eq('tenant_id', tenantId)
      .eq('product_id', productId);

    if (linksReadError) {
      throw new Error(linksReadError.message);
    }

    const existingRows = (existingLinks ?? []) as Array<{ inventory_item_id: string; deleted_at: string | null }>;
    const existingActiveIds = new Set(existingRows.filter((row) => !row.deleted_at).map((row) => row.inventory_item_id));
    const desiredIds = Array.from(new Set(linkedInventoryIds));
    const desiredIdSet = new Set(desiredIds);

    const idsToArchive = Array.from(existingActiveIds).filter((id) => !desiredIdSet.has(id));

    if (idsToArchive.length > 0) {
      const { error: archiveError } = await supabase
        .from('product_inventory_links')
        .update({
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId)
        .eq('product_id', productId)
        .in('inventory_item_id', idsToArchive);

      if (archiveError) {
        throw new Error(archiveError.message);
      }
    }

    if (desiredIds.length > 0) {
      const now = new Date().toISOString();
      const linkRows = desiredIds.map((inventoryItemId) => ({
        tenant_id: tenantId,
        product_id: productId,
        inventory_item_id: inventoryItemId,
        updated_at: now,
        deleted_at: null,
      }));

      const { error: upsertLinksError } = await supabase
        .from('product_inventory_links')
        .upsert(linkRows, { onConflict: 'tenant_id,product_id,inventory_item_id' });

      if (upsertLinksError) {
        throw new Error(upsertLinksError.message);
      }
    }

    return;
  }

  if (tableName === 'inventory_items') {
    const item = payload as LocalInventoryItem;
    const itemId = assertRequiredUuid(item.id, 'inventory_items.id');
    const tenantId = assertRequiredUuid(item.tenant_id, 'inventory_items.tenant_id');
    const { error } = await supabase.from('inventory_items').upsert(
      {
        id: itemId,
        tenant_id: tenantId,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        deleted_at: item.deleted_at ?? null,
        updated_at: item.updated_at ?? undefined,
      },
      { onConflict: 'id' }
    );

    if (error) {
      throw new Error(error.message);
    }

    return;
  }

  if (tableName === 'sales') {
    const salePayload = payload as SaleMutationPayload;
    const saleId = assertRequiredUuid(salePayload.sale.id, 'sales.id');
    const tenantId = assertRequiredUuid(salePayload.sale.tenant_id, 'sales.tenant_id');
    const cashierProfileId = toValidUuidOrNull(salePayload.sale.cashier_profile_id);

    const { error: saleError } = await supabase.from('sales').upsert(
      {
        id: saleId,
        tenant_id: tenantId,
        cashier_profile_id: cashierProfileId,
        total_cents: salePayload.sale.total_cents,
        gross_profit_cents: salePayload.sale.gross_profit_cents,
        expenses_cents: salePayload.sale.expenses_cents,
        net_profit_cents: salePayload.sale.net_profit_cents,
        payment_method: salePayload.sale.payment_method ?? 'cash',
        status: salePayload.sale.status,
        created_at: salePayload.sale.created_at,
      },
      { onConflict: 'id' }
    );

    if (saleError) {
      throw new Error(saleError.message);
    }

    if (salePayload.items.length > 0) {
      const sanitizedItems = salePayload.items
        .map((item) => {
          if (!isUuid(item.id)) {
            return null;
          }

          return {
            id: item.id,
            sale_id: saleId,
            product_id: toValidUuidOrNull(item.product_id),
            tenant_id: tenantId,
            quantity: item.quantity,
            unit_price_cents: item.unit_price_cents,
            cost_price_cents: item.cost_price_cents,
            selling_price_cents: item.selling_price_cents,
            gross_margin_cents: item.gross_margin_cents,
            created_at: item.created_at,
          };
        })
        .filter((item): item is {
          id: string;
          sale_id: string;
          product_id: string | null;
          tenant_id: string;
          quantity: number;
          unit_price_cents: number;
          cost_price_cents: number;
          selling_price_cents: number;
          gross_margin_cents: number;
          created_at: string;
        } => item !== null);

      if (sanitizedItems.length === 0) {
        await markSaleSynced(saleId);
        return;
      }

      const { error: saleItemError } = await supabase.from('sale_items').upsert(
        sanitizedItems,
        { onConflict: 'id' }
      );

      if (saleItemError) {
        throw new Error(saleItemError.message);
      }
    }

    await markSaleSynced(saleId);
    return;
  }

  if (tableName === 'shift_reports') {
    const report = payload as ShiftReportPayload;
    const reportId = assertRequiredUuid(report.id, 'shift_reports.id');
    const tenantId = assertRequiredUuid(report.tenant_id, 'shift_reports.tenant_id');
    const cashierProfileId = toValidUuidOrNull(report.cashier_profile_id);

    const { error } = await supabase.from('shift_reports').upsert(
      {
        id: reportId,
        tenant_id: tenantId,
        cashier_profile_id: cashierProfileId,
        starting_cash_cents: report.starting_cash_cents,
        total_cash_sales_cents: report.total_cash_sales_cents,
        cash_refunds_cents: report.cash_refunds_cents,
        pay_ins_cents: report.pay_ins_cents,
        payouts_cents: report.payouts_cents,
        expected_cash_cents: report.expected_cash_cents,
        actual_cash_cents: report.actual_cash_cents,
        variance_cents: report.variance_cents,
        denomination_breakdown: report.denomination_breakdown,
        payments_summary: report.payments_summary,
        created_at: report.created_at,
      },
      { onConflict: 'id' }
    );

    if (error) {
      throw new Error(error.message);
    }

    await markShiftReportSynced(reportId);
    return;
  }

  if (tableName === 'categories') {
    const category = payload as LocalCategory;
    const categoryId = assertRequiredUuid(category.id, 'categories.id');
    const tenantId = assertRequiredUuid(category.tenant_id, 'categories.tenant_id');
    const { error } = await supabase.from('categories').upsert(
      {
        id: categoryId,
        tenant_id: tenantId,
        name: category.name,
        color: category.color,
        active: category.active,
        created_at: category.created_at,
        updated_at: category.updated_at,
        deleted_at: category.deleted_at,
      },
      { onConflict: 'id' }
    );

    if (error) {
      throw new Error(error.message);
    }

    return;
  }

  if (tableName === 'staff_members') {
    const staffMember = payload as LocalStaffMember;
    const staffId = assertRequiredUuid(staffMember.id, 'staff_members.id');
    const tenantId = assertRequiredUuid(staffMember.tenant_id, 'staff_members.tenant_id');
    const { error } = await supabase.from('staff_members').upsert(
      {
        id: staffId,
        tenant_id: tenantId,
        name: staffMember.name,
        role: staffMember.role,
        phone: staffMember.phone,
        pin_code: staffMember.pin_code,
        active: staffMember.active,
        created_at: staffMember.created_at,
        updated_at: staffMember.updated_at,
        deleted_at: staffMember.deleted_at,
      },
      { onConflict: 'id' }
    );

    if (error) {
      throw new Error(error.message);
    }

    return;
  }

  throw new Error(`Unsupported sync table: ${tableName}`);
};

const pushPendingMutations = async (tenantId: string): Promise<void> => {
  const pendingMutations = await getPendingMutations(tenantId, 100);

  for (const mutation of pendingMutations) {
    if (!['UPSERT'].includes(mutation.operation)) {
      await markMutationSynced(mutation.id);
      continue;
    }

    try {
      await pushMutation(mutation.tableName as SyncableTable, mutation.payload);
      await markMutationSynced(mutation.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync failure';

      if (isIrrecoverableMutationError(message)) {
        await markMutationSynced(mutation.id);
        continue;
      }

      await markMutationFailed(mutation.id, message, mutation.attempts + 1);

      if (isTransientNetworkError(message)) {
        break;
      }
    }
  }
};

const pullProducts = async (
  tenantId: string,
  productsCursor: string
): Promise<{ cursor: string | null; productIds: string[] }> => {
  if (!supabase) {
    return { cursor: null, productIds: [] };
  }

  const { data, error } = await supabase
    .from('products')
    .select('id, tenant_id, category_id, name, image_path, price_cents, selling_price_cents, cost_price_cents, inventory_tracking, stock_count, linked_inventory_item_id, deduction_multiplier, active, updated_at, deleted_at, created_at')
    .eq('tenant_id', tenantId)
    .gte('updated_at', productsCursor)
    .order('updated_at', { ascending: true })
    .limit(2000);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data as ProductRow[]) ?? [];
  if (rows.length === 0) {
    return { cursor: null, productIds: [] };
  }

  const productIds = rows.map((row) => row.id);
  const { data: linkData, error: linkError } = await supabase
    .from('product_inventory_links')
    .select('tenant_id, product_id, inventory_item_id, updated_at, deleted_at')
    .eq('tenant_id', tenantId)
    .in('product_id', productIds);

  if (linkError) {
    throw new Error(linkError.message);
  }

  const linkRows = (linkData as ProductInventoryLinkRow[]) ?? [];
  const linkedIdsMap = buildLinkedIdsMap(linkRows);

  const deletionMap = await loadLocalDeletionMap('local_products', productIds);
  const filteredRows = rows.filter((row) =>
    shouldApplyRemoteUpdate(deletionMap.get(row.id), row.updated_at ?? row.created_at)
  );

  if (filteredRows.length > 0) {
    await upsertLocalProducts(filteredRows.map((row) => toLocalProduct(row, linkedIdsMap.get(row.id))));
  }
  return {
    cursor: rows[rows.length - 1]?.updated_at ?? rows[rows.length - 1]?.created_at ?? null,
    productIds,
  };
};

const pullProductLinkChanges = async (
  tenantId: string,
  productsCursor: string
): Promise<{ cursor: string | null; productIds: string[] }> => {
  if (!supabase) {
    return { cursor: null, productIds: [] };
  }

  const { data, error } = await supabase
    .from('product_inventory_links')
    .select('tenant_id, product_id, inventory_item_id, updated_at, deleted_at')
    .eq('tenant_id', tenantId)
    .gte('updated_at', productsCursor)
    .order('updated_at', { ascending: true })
    .limit(4000);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data as ProductInventoryLinkRow[]) ?? [];
  if (rows.length === 0) {
    return { cursor: null, productIds: [] };
  }

  const productIds = Array.from(new Set(rows.map((row) => row.product_id)));
  return {
    cursor: rows[rows.length - 1]?.updated_at ?? null,
    productIds,
  };
};

const refreshProductsFromCloud = async (tenantId: string, productIds: string[]): Promise<void> => {
  if (!supabase || productIds.length === 0) {
    return;
  }

  const { data: productData, error: productError } = await supabase
    .from('products')
    .select('id, tenant_id, category_id, name, image_path, price_cents, selling_price_cents, cost_price_cents, inventory_tracking, stock_count, linked_inventory_item_id, deduction_multiplier, active, updated_at, deleted_at, created_at')
    .eq('tenant_id', tenantId)
    .in('id', productIds)
    .limit(4000);

  if (productError) {
    throw new Error(productError.message);
  }

  const rows = (productData as ProductRow[]) ?? [];
  if (rows.length === 0) {
    return;
  }

  const { data: linkData, error: linkError } = await supabase
    .from('product_inventory_links')
    .select('tenant_id, product_id, inventory_item_id, updated_at, deleted_at')
    .eq('tenant_id', tenantId)
    .in('product_id', rows.map((row) => row.id));

  if (linkError) {
    throw new Error(linkError.message);
  }

  const linkRows = (linkData as ProductInventoryLinkRow[]) ?? [];
  const linkedIdsMap = buildLinkedIdsMap(linkRows);

  const deletionMap = await loadLocalDeletionMap(
    'local_products',
    rows.map((row) => row.id)
  );
  const filteredRows = rows.filter((row) =>
    shouldApplyRemoteUpdate(deletionMap.get(row.id), row.updated_at ?? row.created_at)
  );

  if (filteredRows.length > 0) {
    await upsertLocalProducts(filteredRows.map((row) => toLocalProduct(row, linkedIdsMap.get(row.id))));
  }
};

const pullCategories = async (tenantId: string, categoriesCursor: string): Promise<string | null> => {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('categories')
    .select('id, tenant_id, name, color, active, created_at, updated_at, deleted_at')
    .eq('tenant_id', tenantId)
    .gte('updated_at', categoriesCursor)
    .order('updated_at', { ascending: true })
    .limit(2000);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data as CategoryRow[]) ?? [];
  if (rows.length === 0) {
    return null;
  }

  await upsertLocalCategories(rows.map(toLocalCategory));
  return rows[rows.length - 1]?.updated_at ?? rows[rows.length - 1]?.created_at ?? null;
};

const pullStaff = async (tenantId: string, staffCursor: string): Promise<string | null> => {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('staff_members')
    .select('id, tenant_id, name, role, phone, pin_code, active, created_at, updated_at, deleted_at')
    .eq('tenant_id', tenantId)
    .gte('updated_at', staffCursor)
    .order('updated_at', { ascending: true })
    .limit(2000);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data as StaffRow[]) ?? [];
  if (rows.length === 0) {
    return null;
  }

  await upsertLocalStaffMembers(rows.map(toLocalStaff));
  return rows[rows.length - 1]?.updated_at ?? rows[rows.length - 1]?.created_at ?? null;
};

const pullInventory = async (tenantId: string, inventoryCursor: string): Promise<string | null> => {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, tenant_id, sku, name, quantity, unit, updated_at, deleted_at')
    .eq('tenant_id', tenantId)
    .gte('updated_at', inventoryCursor)
    .order('updated_at', { ascending: true })
    .limit(2000);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data as InventoryRow[]) ?? [];
  if (rows.length === 0) {
    return null;
  }

  const deletionMap = await loadLocalDeletionMap(
    'local_inventory_items',
    rows.map((row) => row.id)
  );
  const filteredRows = rows.filter((row) => shouldApplyRemoteUpdate(deletionMap.get(row.id), row.updated_at));

  if (filteredRows.length > 0) {
    await upsertLocalInventoryItems(filteredRows.map(toLocalInventory));
  }
  return rows[rows.length - 1]?.updated_at ?? null;
};

const pullRemoteUpdates = async (tenantId: string): Promise<void> => {
  const cursors = await getSyncCursor(tenantId);
  const pulledProducts = await pullProducts(tenantId, cursors.productsCursor);
  const pulledProductLinks = await pullProductLinkChanges(tenantId, cursors.productsCursor);

  const linkOnlyProductIds = pulledProductLinks.productIds.filter((productId) => !pulledProducts.productIds.includes(productId));
  if (linkOnlyProductIds.length > 0) {
    await refreshProductsFromCloud(tenantId, linkOnlyProductIds);
  }

  const nextInventoryCursor = await pullInventory(tenantId, cursors.inventoryCursor);
  const nextCategoryCursor = await pullCategories(tenantId, cursors.categoriesCursor);
  const nextStaffCursor = await pullStaff(tenantId, cursors.staffCursor);
  const nextProductCursor = mergeCursor(pulledProducts.cursor, pulledProductLinks.cursor);

  if (!nextProductCursor && !nextInventoryCursor && !nextCategoryCursor && !nextStaffCursor) {
    return;
  }

  await updateSyncCursor(tenantId, {
    productsCursor: nextProductCursor ?? undefined,
    inventoryCursor: nextInventoryCursor ?? undefined,
    categoriesCursor: nextCategoryCursor ?? undefined,
    staffCursor: nextStaffCursor ?? undefined,
  });
};

const runSyncCycle = async (tenantId: string): Promise<void> => {
  if (running || !supabase) {
    return;
  }

  running = true;
  try {
    await pushPendingMutations(tenantId);
    await pullRemoteUpdates(tenantId);
  } finally {
    running = false;
  }
};

export const startSyncEngine = async (tenantId: string): Promise<void> => {
  await initializeOfflineDb();

  if (activeTenantId === tenantId && syncTimer) {
    return;
  }

  activeTenantId = tenantId;
  if (syncTimer) {
    clearInterval(syncTimer);
  }

  await runSyncCycle(tenantId);
  syncTimer = setInterval(() => {
    if (!activeTenantId) {
      return;
    }

    void runSyncCycle(activeTenantId);
  }, SYNC_INTERVAL_MS);
};

export const triggerSyncNow = async (): Promise<void> => {
  if (!activeTenantId) {
    return;
  }

  await runSyncCycle(activeTenantId);
};

export const stopSyncEngine = (): void => {
  activeTenantId = null;
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
};
