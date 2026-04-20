import * as SQLite from 'expo-sqlite';

let initialized = false;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

type PendingMutationRow = {
  id: string;
  tenant_id: string;
  operation: string;
  table_name: string;
  payload: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
};

export type LocalProduct = {
  id: string;
  tenant_id: string;
  category_id: string | null;
  name: string;
  price_cents: number;
  selling_price_cents: number;
  cost_price_cents: number;
  inventory_tracking: boolean;
  stock_count: number;
  linked_inventory_item_id: string | null;
  deduction_multiplier: number;
  active: boolean;
  updated_at: string;
  deleted_at: string | null;
};

export type LocalInventoryItem = {
  id: string;
  tenant_id: string;
  sku: string | null;
  name: string;
  quantity: number;
  unit: string | null;
  updated_at: string;
  deleted_at: string | null;
};

export type LocalCategory = {
  id: string;
  tenant_id: string;
  name: string;
  color: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type LocalStaffMember = {
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

export type LocalSaleItemInput = {
  id?: string;
  product_id: string | null;
  tenant_id: string;
  quantity: number;
  unit_price_cents: number;
  cost_price_cents?: number;
  selling_price_cents?: number;
};

export type LocalSaleInput = {
  id?: string;
  tenant_id: string;
  cashier_profile_id: string | null;
  total_cents: number;
  expenses_cents?: number;
  status?: string;
  created_at?: string;
  items: LocalSaleItemInput[];
};

export type LocalSale = {
  id: string;
  tenant_id: string;
  cashier_profile_id: string | null;
  total_cents: number;
  gross_profit_cents: number;
  expenses_cents: number;
  net_profit_cents: number;
  status: string;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
};

type ProductStockRow = {
  id: string;
  category_id: string | null;
  selling_price_cents: number;
  cost_price_cents: number;
  inventory_tracking: number;
  stock_count: number;
  linked_inventory_item_id: string | null;
  deduction_multiplier: number | null;
};

export type PendingMutation = {
  id: string;
  tenantId: string;
  operation: string;
  tableName: string;
  payload: unknown;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
};

type SyncCursorRow = {
  tenant_id: string;
  products_cursor: string | null;
  inventory_cursor: string | null;
  categories_cursor: string | null;
  staff_cursor: string | null;
  updated_at: string;
};

const ISO_MIN_DATE = '1970-01-01T00:00:00.000Z';

const nowIso = (): string => new Date().toISOString();

const createLocalId = (): string => {
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
};

const getDb = async (): Promise<SQLite.SQLiteDatabase> => {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('takopos.db');
  }

  return dbPromise;
};

export const withOfflineDb = async <T>(handler: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> => {
  await initializeOfflineDb();
  const db = await getDb();
  return handler(db);
};

const mapPendingMutation = (row: PendingMutationRow): PendingMutation => ({
  id: row.id,
  tenantId: row.tenant_id,
  operation: row.operation,
  tableName: row.table_name,
  payload: JSON.parse(row.payload),
  createdAt: row.created_at,
  attempts: row.attempts,
  lastError: row.last_error,
  nextAttemptAt: row.next_attempt_at,
});

export const initializeOfflineDb = async (): Promise<void> => {
  if (initialized) {
    return;
  }

  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS local_products (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      category_id TEXT,
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      selling_price_cents INTEGER NOT NULL DEFAULT 0,
      cost_price_cents INTEGER NOT NULL DEFAULT 0,
      inventory_tracking INTEGER NOT NULL DEFAULT 1,
      stock_count REAL NOT NULL DEFAULT 0,
      linked_inventory_item_id TEXT,
      deduction_multiplier REAL NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_local_products_tenant_updated
    ON local_products (tenant_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS local_categories (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_local_categories_tenant_name
    ON local_categories (tenant_id, name ASC);

    CREATE TABLE IF NOT EXISTS local_staff_members (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      phone TEXT,
      pin_code TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_local_staff_tenant_name
    ON local_staff_members (tenant_id, name ASC);

    CREATE TABLE IF NOT EXISTS local_inventory_items (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      sku TEXT,
      name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      unit TEXT,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_local_inventory_tenant_updated
    ON local_inventory_items (tenant_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS local_sales (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      cashier_profile_id TEXT,
      total_cents INTEGER NOT NULL,
      gross_profit_cents INTEGER NOT NULL DEFAULT 0,
      expenses_cents INTEGER NOT NULL DEFAULT 0,
      net_profit_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      synced_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_local_sales_tenant_created
    ON local_sales (tenant_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS local_sale_items (
      id TEXT PRIMARY KEY NOT NULL,
      sale_id TEXT NOT NULL,
      product_id TEXT,
      tenant_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      cost_price_cents INTEGER NOT NULL DEFAULT 0,
      selling_price_cents INTEGER NOT NULL DEFAULT 0,
      gross_margin_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(sale_id) REFERENCES local_sales(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_local_sale_items_sale
    ON local_sale_items (sale_id);

    CREATE TABLE IF NOT EXISTS pending_mutations (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      table_name TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_pending_mutations_tenant_created
    ON pending_mutations (tenant_id, created_at);

    CREATE TABLE IF NOT EXISTS sync_cursors (
      tenant_id TEXT PRIMARY KEY NOT NULL,
      products_cursor TEXT,
      inventory_cursor TEXT,
      categories_cursor TEXT,
      staff_cursor TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  await db.execAsync(`
    ALTER TABLE local_products ADD COLUMN category_id TEXT;
  `).catch(() => undefined);

  await db.execAsync(`
    ALTER TABLE local_products ADD COLUMN selling_price_cents INTEGER NOT NULL DEFAULT 0;
  `).catch(() => undefined);

  await db.execAsync(`
    ALTER TABLE local_products ADD COLUMN cost_price_cents INTEGER NOT NULL DEFAULT 0;
  `).catch(() => undefined);

  await db.execAsync(`
    ALTER TABLE local_products ADD COLUMN inventory_tracking INTEGER NOT NULL DEFAULT 1;
  `).catch(() => undefined);

  await db.execAsync(`
    ALTER TABLE local_products ADD COLUMN stock_count REAL NOT NULL DEFAULT 0;
  `).catch(() => undefined);

  await db.execAsync(`
    ALTER TABLE local_products ADD COLUMN linked_inventory_item_id TEXT;
  `).catch(() => undefined);

  await db.execAsync(`
    ALTER TABLE local_products ADD COLUMN deduction_multiplier REAL NOT NULL DEFAULT 1;
  `).catch(() => undefined);

  await db.execAsync(`
    UPDATE local_products
    SET selling_price_cents = CASE WHEN selling_price_cents = 0 THEN price_cents ELSE selling_price_cents END;
  `).catch(() => undefined);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS local_categories (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
  `).catch(() => undefined);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS local_staff_members (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      phone TEXT,
      pin_code TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
  `).catch(() => undefined);

  await db.execAsync(`
    ALTER TABLE local_sales ADD COLUMN gross_profit_cents INTEGER NOT NULL DEFAULT 0;
  `).catch(() => undefined);

  await db.execAsync(`
    ALTER TABLE local_sales ADD COLUMN expenses_cents INTEGER NOT NULL DEFAULT 0;
  `).catch(() => undefined);

  await db.execAsync(`
    ALTER TABLE local_sales ADD COLUMN net_profit_cents INTEGER NOT NULL DEFAULT 0;
  `).catch(() => undefined);

  await db.execAsync(`
    ALTER TABLE local_sale_items ADD COLUMN cost_price_cents INTEGER NOT NULL DEFAULT 0;
  `).catch(() => undefined);

  await db.execAsync(`
    ALTER TABLE local_sale_items ADD COLUMN selling_price_cents INTEGER NOT NULL DEFAULT 0;
  `).catch(() => undefined);

  await db.execAsync(`
    ALTER TABLE local_sale_items ADD COLUMN gross_margin_cents INTEGER NOT NULL DEFAULT 0;
  `).catch(() => undefined);

  await db.execAsync(`
    ALTER TABLE pending_mutations ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
  `).catch(() => undefined);

  await db.execAsync(`
    ALTER TABLE pending_mutations ADD COLUMN last_error TEXT;
  `).catch(() => undefined);

  await db.execAsync(`
    ALTER TABLE pending_mutations ADD COLUMN next_attempt_at TEXT NOT NULL DEFAULT (datetime('now'));
  `).catch(() => undefined);

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_pending_mutations_retry_window
    ON pending_mutations (tenant_id, next_attempt_at, attempts);
  `).catch(() => undefined);

  initialized = true;
};

export const listLocalProducts = async (tenantId: string): Promise<LocalProduct[]> => {
  await initializeOfflineDb();
  const db = await getDb();
  const rows = await db.getAllAsync<
    Omit<LocalProduct, 'active' | 'inventory_tracking'> & { active: number; inventory_tracking: number }
  >(
    `
      SELECT
        id,
        tenant_id,
        category_id,
        name,
        price_cents,
        selling_price_cents,
        cost_price_cents,
        inventory_tracking,
        stock_count,
        linked_inventory_item_id,
        deduction_multiplier,
        active,
        updated_at,
        deleted_at
      FROM local_products
      WHERE tenant_id = ?
        AND deleted_at IS NULL
      ORDER BY name ASC
    `,
    [tenantId]
  );

  return rows.map((row) => ({
    ...row,
    active: Boolean(row.active),
    inventory_tracking: Boolean(row.inventory_tracking),
    linked_inventory_item_id: row.linked_inventory_item_id ?? null,
    deduction_multiplier: Number(row.deduction_multiplier ?? 1),
  }));
};

export const listLocalCategories = async (tenantId: string): Promise<LocalCategory[]> => {
  await initializeOfflineDb();
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<LocalCategory, 'active'> & { active: number }>(
    `
      SELECT id, tenant_id, name, color, active, created_at, updated_at, deleted_at
      FROM local_categories
      WHERE tenant_id = ?
        AND deleted_at IS NULL
      ORDER BY name ASC
    `,
    [tenantId]
  );

  return rows.map((row) => ({ ...row, active: Boolean(row.active) }));
};

export const listLocalStaffMembers = async (tenantId: string): Promise<LocalStaffMember[]> => {
  await initializeOfflineDb();
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<LocalStaffMember, 'active'> & { active: number }>(
    `
      SELECT id, tenant_id, name, role, phone, pin_code, active, created_at, updated_at, deleted_at
      FROM local_staff_members
      WHERE tenant_id = ?
        AND deleted_at IS NULL
      ORDER BY name ASC
    `,
    [tenantId]
  );

  return rows.map((row) => ({ ...row, active: Boolean(row.active) }));
};

export const listLocalInventoryItems = async (tenantId: string): Promise<LocalInventoryItem[]> => {
  await initializeOfflineDb();
  const db = await getDb();
  return db.getAllAsync<LocalInventoryItem>(
    `
      SELECT id, tenant_id, sku, name, quantity, unit, updated_at, deleted_at
      FROM local_inventory_items
      WHERE tenant_id = ?
        AND deleted_at IS NULL
      ORDER BY name ASC
    `,
    [tenantId]
  );
};

export const listLocalSales = async (tenantId: string, limit = 50): Promise<LocalSale[]> => {
  await initializeOfflineDb();
  const db = await getDb();
  return db.getAllAsync<LocalSale>(
    `
      SELECT
        id,
        tenant_id,
        cashier_profile_id,
        total_cents,
        gross_profit_cents,
        expenses_cents,
        net_profit_cents,
        status,
        created_at,
        updated_at,
        synced_at
      FROM local_sales
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [tenantId, limit]
  );
};

export const upsertLocalProducts = async (products: LocalProduct[]): Promise<void> => {
  if (products.length === 0) {
    return;
  }

  await initializeOfflineDb();
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const product of products) {
      await db.runAsync(
        `
          INSERT INTO local_products (
            id,
            tenant_id,
            category_id,
            name,
            price_cents,
            selling_price_cents,
            cost_price_cents,
            inventory_tracking,
            stock_count,
            linked_inventory_item_id,
            deduction_multiplier,
            active,
            updated_at,
            deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            tenant_id = excluded.tenant_id,
            category_id = excluded.category_id,
            name = excluded.name,
            price_cents = excluded.price_cents,
            selling_price_cents = excluded.selling_price_cents,
            cost_price_cents = excluded.cost_price_cents,
            inventory_tracking = excluded.inventory_tracking,
            stock_count = excluded.stock_count,
            linked_inventory_item_id = excluded.linked_inventory_item_id,
            deduction_multiplier = excluded.deduction_multiplier,
            active = excluded.active,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at
        `,
        [
          product.id,
          product.tenant_id,
          product.category_id,
          product.name,
          product.price_cents,
          product.selling_price_cents,
          product.cost_price_cents,
          product.inventory_tracking ? 1 : 0,
          product.stock_count,
          product.linked_inventory_item_id,
          product.deduction_multiplier,
          product.active ? 1 : 0,
          product.updated_at,
          product.deleted_at,
        ]
      );
    }
  });
};

export const upsertLocalCategories = async (categories: LocalCategory[]): Promise<void> => {
  if (categories.length === 0) {
    return;
  }

  await initializeOfflineDb();
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const category of categories) {
      await db.runAsync(
        `
          INSERT INTO local_categories (id, tenant_id, name, color, active, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            tenant_id = excluded.tenant_id,
            name = excluded.name,
            color = excluded.color,
            active = excluded.active,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at
        `,
        [
          category.id,
          category.tenant_id,
          category.name,
          category.color,
          category.active ? 1 : 0,
          category.created_at,
          category.updated_at,
          category.deleted_at,
        ]
      );
    }
  });
};

export const upsertLocalStaffMembers = async (staffMembers: LocalStaffMember[]): Promise<void> => {
  if (staffMembers.length === 0) {
    return;
  }

  await initializeOfflineDb();
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const staffMember of staffMembers) {
      await db.runAsync(
        `
          INSERT INTO local_staff_members (id, tenant_id, name, role, phone, pin_code, active, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            tenant_id = excluded.tenant_id,
            name = excluded.name,
            role = excluded.role,
            phone = excluded.phone,
            pin_code = excluded.pin_code,
            active = excluded.active,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at
        `,
        [
          staffMember.id,
          staffMember.tenant_id,
          staffMember.name,
          staffMember.role,
          staffMember.phone,
          staffMember.pin_code,
          staffMember.active ? 1 : 0,
          staffMember.created_at,
          staffMember.updated_at,
          staffMember.deleted_at,
        ]
      );
    }
  });
};

export const upsertLocalInventoryItems = async (items: LocalInventoryItem[]): Promise<void> => {
  if (items.length === 0) {
    return;
  }

  await initializeOfflineDb();
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const item of items) {
      await db.runAsync(
        `
          INSERT INTO local_inventory_items (id, tenant_id, sku, name, quantity, unit, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            tenant_id = excluded.tenant_id,
            sku = excluded.sku,
            name = excluded.name,
            quantity = excluded.quantity,
            unit = excluded.unit,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at
        `,
        [item.id, item.tenant_id, item.sku, item.name, item.quantity, item.unit, item.updated_at, item.deleted_at]
      );
    }
  });
};

export const enqueueMutation = async (
  tenantId: string,
  operation: string,
  tableName: string,
  payload: unknown
): Promise<string> => {
  await initializeOfflineDb();
  const db = await getDb();

  const mutationId = createLocalId();
  const createdAt = nowIso();
  await db.runAsync(
    `
      INSERT INTO pending_mutations (
        id,
        tenant_id,
        operation,
        table_name,
        payload,
        created_at,
        attempts,
        last_error,
        next_attempt_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
    `,
    [mutationId, tenantId, operation, tableName, JSON.stringify(payload), createdAt, createdAt]
  );

  return mutationId;
};

export const createLocalSale = async (input: LocalSaleInput): Promise<string> => {
  await initializeOfflineDb();
  const db = await getDb();

  const saleId = input.id ?? createLocalId();
  const createdAt = input.created_at ?? nowIso();
  const updatedAt = nowIso();
  const status = input.status ?? 'completed';
  const normalizedExpenses = Math.max(0, input.expenses_cents ?? 0);
  const mutationBaseMs = Date.parse(createdAt);
  const productMutationAt = new Date(mutationBaseMs + 1).toISOString();
  const inventoryMutationAt = new Date(mutationBaseMs + 2).toISOString();
  const saleMutationAt = new Date(mutationBaseMs + 3).toISOString();

  await db.withTransactionAsync(async () => {
    let grossProfitCents = 0;
    const saleItems = [] as Array<{
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

    const productStockUpdates = new Map<string, number>();
    const inventoryItemUpdates = new Map<string, number>();

    for (const item of input.items) {
      const quantity = Math.max(0, item.quantity);
      if (quantity <= 0) {
        continue;
      }

      let sellingPriceCents = item.selling_price_cents ?? item.unit_price_cents;
      let costPriceCents = item.cost_price_cents ?? 0;

      if (item.product_id) {
        const product = await db.getFirstAsync<ProductStockRow>(
          `
            SELECT id, selling_price_cents, cost_price_cents, inventory_tracking, stock_count, linked_inventory_item_id, deduction_multiplier
            FROM local_products
            WHERE id = ? AND tenant_id = ?
            LIMIT 1
          `,
          [item.product_id, input.tenant_id]
        );

        if (product) {
          sellingPriceCents = item.selling_price_cents ?? product.selling_price_cents;
          costPriceCents = item.cost_price_cents ?? product.cost_price_cents;

          if (product.linked_inventory_item_id) {
            const linkedMultiplier = Number(product.deduction_multiplier ?? 1);

            if (!Number.isFinite(linkedMultiplier) || linkedMultiplier <= 0) {
              throw new Error(`Invalid linked inventory multiplier for item ${item.product_id}`);
            }

            const linkedInventory = await db.getFirstAsync<{ id: string; quantity: number }>(
              `
                SELECT id, quantity
                FROM local_inventory_items
                WHERE id = ?
                  AND tenant_id = ?
                  AND deleted_at IS NULL
                LIMIT 1
              `,
              [product.linked_inventory_item_id, input.tenant_id]
            );

            if (!linkedInventory) {
              throw new Error(`Linked inventory item not found for item ${item.product_id}`);
            }

            const projectedQuantity = (inventoryItemUpdates.get(linkedInventory.id) ?? linkedInventory.quantity) - quantity * linkedMultiplier;
            if (projectedQuantity < 0) {
              throw new Error(`Insufficient linked inventory for item ${item.product_id}`);
            }

            inventoryItemUpdates.set(linkedInventory.id, projectedQuantity);
          } else if (Boolean(product.inventory_tracking)) {
            const projectedQuantity = (productStockUpdates.get(product.id) ?? product.stock_count) - quantity;
            if (projectedQuantity < 0) {
              throw new Error(`Insufficient stock for item ${item.product_id}`);
            }

            productStockUpdates.set(product.id, projectedQuantity);
          }
        }
      }

      const grossMarginCents = sellingPriceCents - costPriceCents;
      grossProfitCents += Math.round(grossMarginCents * quantity);

      saleItems.push({
        id: item.id ?? createLocalId(),
        sale_id: saleId,
        product_id: item.product_id,
        tenant_id: item.tenant_id,
        quantity,
        unit_price_cents: sellingPriceCents,
        cost_price_cents: costPriceCents,
        selling_price_cents: sellingPriceCents,
        gross_margin_cents: grossMarginCents,
        created_at: createdAt,
      });
    }

    const netProfitCents = grossProfitCents - normalizedExpenses;

    await db.runAsync(
      `
        INSERT INTO local_sales (
          id,
          tenant_id,
          cashier_profile_id,
          total_cents,
          gross_profit_cents,
          expenses_cents,
          net_profit_cents,
          status,
          created_at,
          updated_at,
          synced_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `,
      [
        saleId,
        input.tenant_id,
        input.cashier_profile_id,
        input.total_cents,
        grossProfitCents,
        normalizedExpenses,
        netProfitCents,
        status,
        createdAt,
        updatedAt,
      ]
    );

    for (const item of saleItems) {
      await db.runAsync(
        `
          INSERT INTO local_sale_items (
            id,
            sale_id,
            product_id,
            tenant_id,
            quantity,
            unit_price_cents,
            cost_price_cents,
            selling_price_cents,
            gross_margin_cents,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          item.id,
          item.sale_id,
          item.product_id,
          item.tenant_id,
          item.quantity,
          item.unit_price_cents,
          item.cost_price_cents,
          item.selling_price_cents,
          item.gross_margin_cents,
          item.created_at,
        ]
      );
    }

    for (const [productId, nextStock] of productStockUpdates.entries()) {
      await db.runAsync(
        `
          UPDATE local_products
          SET stock_count = ?,
              updated_at = ?
          WHERE id = ?
            AND tenant_id = ?
        `,
        [nextStock, updatedAt, productId, input.tenant_id]
      );

      const nextProduct = await db.getFirstAsync<
        Omit<LocalProduct, 'active' | 'inventory_tracking'> & { active: number; inventory_tracking: number }
      >(
        `
          SELECT
            id,
            tenant_id,
            category_id,
            name,
            price_cents,
            selling_price_cents,
            cost_price_cents,
            inventory_tracking,
            stock_count,
            linked_inventory_item_id,
            deduction_multiplier,
            active,
            updated_at,
            deleted_at
          FROM local_products
          WHERE id = ?
          LIMIT 1
        `,
        [productId]
      );

      if (nextProduct) {
        const nextProductPayload: LocalProduct = {
          ...nextProduct,
          active: Boolean(nextProduct.active),
          inventory_tracking: Boolean(nextProduct.inventory_tracking),
          category_id: nextProduct.category_id,
          linked_inventory_item_id: nextProduct.linked_inventory_item_id ?? null,
          deduction_multiplier: Number(nextProduct.deduction_multiplier ?? 1),
        };

        await db.runAsync(
          `
            INSERT INTO pending_mutations (
              id,
              tenant_id,
              operation,
              table_name,
              payload,
              created_at,
              attempts,
              last_error,
              next_attempt_at
            )
            VALUES (?, ?, 'UPSERT', 'products', ?, ?, 0, NULL, ?)
          `,
          [createLocalId(), input.tenant_id, JSON.stringify(nextProductPayload), productMutationAt, productMutationAt]
        );
      }
    }

    for (const [inventoryItemId, nextQuantity] of inventoryItemUpdates.entries()) {
      await db.runAsync(
        `
          UPDATE local_inventory_items
          SET quantity = ?,
              updated_at = ?
          WHERE id = ?
            AND tenant_id = ?
        `,
        [nextQuantity, updatedAt, inventoryItemId, input.tenant_id]
      );

      const nextInventoryItem = await db.getFirstAsync<LocalInventoryItem>(
        `
          SELECT id, tenant_id, sku, name, quantity, unit, updated_at, deleted_at
          FROM local_inventory_items
          WHERE id = ?
            AND tenant_id = ?
          LIMIT 1
        `,
        [inventoryItemId, input.tenant_id]
      );

      if (nextInventoryItem) {
        await db.runAsync(
          `
            INSERT INTO pending_mutations (
              id,
              tenant_id,
              operation,
              table_name,
              payload,
              created_at,
              attempts,
              last_error,
              next_attempt_at
            )
            VALUES (?, ?, 'UPSERT', 'inventory_items', ?, ?, 0, NULL, ?)
          `,
          [createLocalId(), input.tenant_id, JSON.stringify(nextInventoryItem), inventoryMutationAt, inventoryMutationAt]
        );
      }
    }

    const payload = {
      sale: {
        id: saleId,
        tenant_id: input.tenant_id,
        cashier_profile_id: input.cashier_profile_id,
        total_cents: input.total_cents,
        gross_profit_cents: grossProfitCents,
        expenses_cents: normalizedExpenses,
        net_profit_cents: netProfitCents,
        status,
        created_at: createdAt,
      },
      items: saleItems,
    };

    await db.runAsync(
      `
        INSERT INTO pending_mutations (
          id,
          tenant_id,
          operation,
          table_name,
          payload,
          created_at,
          attempts,
          last_error,
          next_attempt_at
        )
        VALUES (?, ?, 'UPSERT', 'sales', ?, ?, 0, NULL, ?)
      `,
      [createLocalId(), input.tenant_id, JSON.stringify(payload), saleMutationAt, saleMutationAt]
    );
  });

  return saleId;
};

export const upsertLocalProductAndQueue = async (product: LocalProduct): Promise<void> => {
  await upsertLocalProducts([product]);
  await enqueueMutation(product.tenant_id, 'UPSERT', 'products', product);
};

export const upsertLocalInventoryAndQueue = async (item: LocalInventoryItem): Promise<void> => {
  await upsertLocalInventoryItems([item]);
  await enqueueMutation(item.tenant_id, 'UPSERT', 'inventory_items', item);
};

export const getPendingMutations = async (tenantId: string, limit = 50): Promise<PendingMutation[]> => {
  await initializeOfflineDb();
  const db = await getDb();

  const rows = await db.getAllAsync<PendingMutationRow>(
    `
      SELECT id, tenant_id, operation, table_name, payload, created_at, attempts, last_error, next_attempt_at
      FROM pending_mutations
      WHERE tenant_id = ?
        AND next_attempt_at <= ?
      ORDER BY created_at ASC
      LIMIT ?
    `,
    [tenantId, nowIso(), limit]
  );

  return rows.map(mapPendingMutation);
};

export const getPendingMutationCount = async (tenantId: string): Promise<number> => {
  await initializeOfflineDb();
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(1) as count FROM pending_mutations WHERE tenant_id = ?',
    [tenantId]
  );

  return row?.count ?? 0;
};

export const markMutationSynced = async (mutationId: string): Promise<void> => {
  await initializeOfflineDb();
  const db = await getDb();
  await db.runAsync('DELETE FROM pending_mutations WHERE id = ?', [mutationId]);
};

export const markMutationFailed = async (mutationId: string, errorMessage: string, attempts: number): Promise<void> => {
  await initializeOfflineDb();
  const db = await getDb();

  const retryDelayMs = Math.min(5 * 60 * 1000, 1000 * Math.max(1, attempts) * 2);
  const nextAttemptAt = new Date(Date.now() + retryDelayMs).toISOString();

  await db.runAsync(
    `
      UPDATE pending_mutations
      SET attempts = ?,
          last_error = ?,
          next_attempt_at = ?
      WHERE id = ?
    `,
    [attempts, errorMessage.slice(0, 500), nextAttemptAt, mutationId]
  );
};

export const markSaleSynced = async (saleId: string): Promise<void> => {
  await initializeOfflineDb();
  const db = await getDb();
  await db.runAsync('UPDATE local_sales SET synced_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), saleId]);
};

export const getSyncCursor = async (
  tenantId: string
): Promise<{ productsCursor: string; inventoryCursor: string; categoriesCursor: string; staffCursor: string }> => {
  await initializeOfflineDb();
  const db = await getDb();

  const row = await db.getFirstAsync<SyncCursorRow>('SELECT tenant_id, products_cursor, inventory_cursor, categories_cursor, staff_cursor, updated_at FROM sync_cursors WHERE tenant_id = ?', [
    tenantId,
  ]);

  if (!row) {
    return {
      productsCursor: ISO_MIN_DATE,
      inventoryCursor: ISO_MIN_DATE,
      categoriesCursor: ISO_MIN_DATE,
      staffCursor: ISO_MIN_DATE,
    };
  }

  return {
    productsCursor: row.products_cursor ?? ISO_MIN_DATE,
    inventoryCursor: row.inventory_cursor ?? ISO_MIN_DATE,
    categoriesCursor: row.categories_cursor ?? ISO_MIN_DATE,
    staffCursor: row.staff_cursor ?? ISO_MIN_DATE,
  };
};

export const updateSyncCursor = async (
  tenantId: string,
  cursors: { productsCursor?: string; inventoryCursor?: string; categoriesCursor?: string; staffCursor?: string }
): Promise<void> => {
  await initializeOfflineDb();
  const db = await getDb();

  const current = await getSyncCursor(tenantId);
  const nextProducts = cursors.productsCursor ?? current.productsCursor;
  const nextInventory = cursors.inventoryCursor ?? current.inventoryCursor;
  const nextCategories = cursors.categoriesCursor ?? current.categoriesCursor;
  const nextStaff = cursors.staffCursor ?? current.staffCursor;
  const updatedAt = nowIso();

  await db.runAsync(
    `
      INSERT INTO sync_cursors (tenant_id, products_cursor, inventory_cursor, categories_cursor, staff_cursor, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        products_cursor = excluded.products_cursor,
        inventory_cursor = excluded.inventory_cursor,
        categories_cursor = excluded.categories_cursor,
        staff_cursor = excluded.staff_cursor,
        updated_at = excluded.updated_at
    `,
    [tenantId, nextProducts, nextInventory, nextCategories, nextStaff, updatedAt]
  );
};