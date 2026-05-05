import {
  addShiftEvent,
  createShift,
  createShiftReport,
  getActiveShift,
  listShiftEvents,
  withOfflineDb,
  type LocalShift,
} from './offlineDb';

type ShiftSalesTotals = {
  cash: number;
  card: number;
  qr: number;
};

export type ShiftSummary = {
  startingCashCents: number;
  totalCashSalesCents: number;
  cashRefundsCents: number;
  payInsCents: number;
  payoutsCents: number;
  expectedCashCents: number;
  paymentsSummary: ShiftSalesTotals;
};

export const loadActiveShift = async (tenantId: string): Promise<LocalShift | null> => {
  return getActiveShift(tenantId);
};

const sumShiftSales = async (tenantId: string, startAt: string, endAt: string): Promise<ShiftSalesTotals> => {
  return withOfflineDb(async (db) => {
    const rows = await db.getAllAsync<{ payment_method: string | null; total_cents: number | null }>(
      `
        SELECT payment_method, COALESCE(SUM(total_cents), 0) as total_cents
        FROM local_sales
        WHERE tenant_id = ?
          AND status = 'completed'
          AND created_at >= ?
          AND created_at <= ?
        GROUP BY payment_method
      `,
      [tenantId, startAt, endAt]
    );

    const totals = rows.reduce(
      (acc, row) => {
        const method = row.payment_method ?? 'cash';
        const value = Number(row.total_cents ?? 0);

        if (method === 'card') {
          acc.card += value;
        } else if (method === 'qr') {
          acc.qr += value;
        } else {
          acc.cash += value;
        }

        return acc;
      },
      { cash: 0, card: 0, qr: 0 }
    );

    return totals;
  });
};

export const getShiftSummary = async (shift: LocalShift): Promise<ShiftSummary> => {
  const endAt = shift.closed_at ?? new Date().toISOString();
  const paymentsSummary = await sumShiftSales(shift.tenant_id, shift.opened_at, endAt);
  const events = (await listShiftEvents(shift.id)).filter((event) => event.event_type !== 'opening');

  const payInsCents = events.filter((event) => event.amount_cents > 0).reduce((sum, event) => sum + event.amount_cents, 0);
  const payoutsCents = events.filter((event) => event.amount_cents < 0).reduce((sum, event) => sum + Math.abs(event.amount_cents), 0);
  const adjustmentsCents = events.reduce((sum, event) => sum + event.amount_cents, 0);

  const cashRefundsCents = 0;
  const expectedCashCents = shift.starting_cash_cents + paymentsSummary.cash - cashRefundsCents + adjustmentsCents;

  return {
    startingCashCents: shift.starting_cash_cents,
    totalCashSalesCents: paymentsSummary.cash,
    cashRefundsCents,
    payInsCents,
    payoutsCents,
    expectedCashCents,
    paymentsSummary,
  };
};

export const openShift = async (input: {
  tenantId: string;
  cashierProfileId: string | null;
  startingCashCents: number;
}): Promise<LocalShift> => {
  return createShift({
    tenantId: input.tenantId,
    cashierProfileId: input.cashierProfileId,
    startingCashCents: input.startingCashCents,
  });
};

export const recordShiftEvent = async (input: {
  shiftId: string;
  tenantId: string;
  cashierProfileId: string | null;
  type: 'pay_in' | 'pay_out';
  amountCents: number;
  reason: string;
}): Promise<string> => {
  const amount = Math.max(0, input.amountCents);
  const signedAmount = input.type === 'pay_out' ? -amount : amount;

  return addShiftEvent({
    shiftId: input.shiftId,
    tenantId: input.tenantId,
    cashierProfileId: input.cashierProfileId,
    type: input.type,
    amountCents: signedAmount,
    reason: input.reason,
  });
};

export const closeShift = async (input: {
  shift: LocalShift;
  summary: ShiftSummary;
  actualCashCents: number;
  denominationBreakdown: Record<string, number>;
}): Promise<string> => {
  const varianceCents = input.actualCashCents - input.summary.expectedCashCents;

  return createShiftReport({
    shiftId: input.shift.id,
    tenantId: input.shift.tenant_id,
    cashierProfileId: input.shift.cashier_profile_id,
    startingCashCents: input.summary.startingCashCents,
    totalCashSalesCents: input.summary.totalCashSalesCents,
    cashRefundsCents: input.summary.cashRefundsCents,
    payInsCents: input.summary.payInsCents,
    payoutsCents: input.summary.payoutsCents,
    expectedCashCents: input.summary.expectedCashCents,
    actualCashCents: input.actualCashCents,
    varianceCents,
    denominationBreakdown: input.denominationBreakdown,
    paymentsSummary: input.summary.paymentsSummary,
  });
};
