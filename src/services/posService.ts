import {
  createLocalSale,
  getPendingMutationCount,
  withOfflineDb,
  listLocalInventoryItems,
  listLocalProducts,
  listLocalSales,
  type LocalSale,
  type LocalSaleInput,
} from './offlineDb';
import { triggerSyncNow } from './syncService';

export type PosSnapshot = {
  productsCount: number;
  inventoryCount: number;
  salesCount: number;
  pendingMutations: number;
  grossProfitCents: number;
  expensesCents: number;
  netProfitCents: number;
  latestSale: LocalSale | null;
};

export const getPosSnapshot = async (tenantId: string): Promise<PosSnapshot> => {
  const [products, inventory, salesAgg, latestSale, pendingMutations] = await Promise.all([
    listLocalProducts(tenantId),
    listLocalInventoryItems(tenantId),
    withOfflineDb(async (db) => {
      return db.getFirstAsync<{
        gross_profit_cents: number | null;
        expenses_cents: number | null;
        net_profit_cents: number | null;
      }>(
        `
          SELECT
            COALESCE(SUM(gross_profit_cents), 0) AS gross_profit_cents,
            COALESCE(SUM(expenses_cents), 0) AS expenses_cents,
            COALESCE(SUM(net_profit_cents), 0) AS net_profit_cents
          FROM local_sales
          WHERE tenant_id = ?
        `,
        [tenantId]
      );
    }),
    withOfflineDb(async (db) => {
      return db.getFirstAsync<LocalSale>(
        `
          SELECT
            id,
            tenant_id,
            cashier_profile_id,
            total_cents,
            gross_profit_cents,
            expenses_cents,
            net_profit_cents,
            payment_method,
            status,
            created_at,
            updated_at,
            synced_at
          FROM local_sales
          WHERE tenant_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [tenantId]
      );
    }),
    getPendingMutationCount(tenantId),
  ]);

  return {
    productsCount: products.length,
    inventoryCount: inventory.length,
    salesCount: await withOfflineDb(async (db) => {
      const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(1) as count FROM local_sales WHERE tenant_id = ?', [tenantId]);
      return row?.count ?? 0;
    }),
    pendingMutations,
    grossProfitCents: salesAgg?.gross_profit_cents ?? 0,
    expensesCents: salesAgg?.expenses_cents ?? 0,
    netProfitCents: salesAgg?.net_profit_cents ?? 0,
    latestSale: latestSale ?? null,
  };
};

export const createSaleLocalFirst = async (input: LocalSaleInput): Promise<string> => {
  const saleId = await createLocalSale(input);
  void triggerSyncNow();
  return saleId;
};
