import {
  createLocalSale,
  getPendingMutationCount,
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
  const [products, inventory, sales, pendingMutations] = await Promise.all([
    listLocalProducts(tenantId),
    listLocalInventoryItems(tenantId),
    listLocalSales(tenantId, 1),
    getPendingMutationCount(tenantId),
  ]);

  return {
    productsCount: products.length,
    inventoryCount: inventory.length,
    salesCount: sales.length,
    pendingMutations,
    grossProfitCents: sales.reduce((sum, sale) => sum + sale.gross_profit_cents, 0),
    expensesCents: sales.reduce((sum, sale) => sum + sale.expenses_cents, 0),
    netProfitCents: sales.reduce((sum, sale) => sum + sale.net_profit_cents, 0),
    latestSale: sales[0] ?? null,
  };
};

export const createSaleLocalFirst = async (input: LocalSaleInput): Promise<string> => {
  const saleId = await createLocalSale(input);
  void triggerSyncNow();
  return saleId;
};
