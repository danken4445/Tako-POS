import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getPendingMutationCount, listLocalCategories, listLocalProducts, type LocalCategory, type LocalProduct } from '../../services/offlineDb';
import { resolveProductImageUrl } from '../../services/adminService';
import { createSaleLocalFirst, getPosSnapshot, type PosSnapshot } from '../../services/posService';
import { closeShift, getShiftSummary, loadActiveShift, openShift, recordShiftEvent, type ShiftSummary } from '../../services/shiftService';
import { openCashDrawer, printZReport } from '../../services/posHardware';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { supabase } from '../../lib/supabase';

type DisplayCategory = 'all' | string;

type CatalogItem = {
  key: string;
  productId: string | null;
  name: string;
  priceCents: number;
  costCents: number;
  sellingPriceCents: number;
  stockCount: number;
  inventoryTracking: boolean;
  categoryKey: string;
  categoryLabel: string;
  icon: string;
};

type CartLine = CatalogItem & { quantity: number };

type CategoryTab = {
  key: DisplayCategory;
  label: string;
};

const CASH_BILLS = [1000, 500, 100, 50, 20, 10];
const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1];
const TAX_RATE = 0.08;

const phpFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const money = (cents: number): string => phpFormatter.format(cents / 100);

const formatCentsAsPesoInput = (cents: number): string => (Math.max(0, cents) / 100).toFixed(2);

const normalizeCurrencyInput = (value: string): string => {
  const sanitized = value.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = sanitized.split('.');
  const decimal = rest.join('');

  if (!sanitized.includes('.')) {
    return whole;
  }

  return `${whole}.${decimal.slice(0, 2)}`;
};

const parsePesoInputToCents = (value: string): number => {
  const normalized = normalizeCurrencyInput(value);
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.round(parsed * 100));
};

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ');

const toDisplayCategory = (value: string): string => {
  const normalized = normalize(value);

  if (normalized.includes('drink') || normalized.includes('coffee') || normalized.includes('tea') || normalized.includes('juice') || normalized.includes('latte') || normalized.includes('beverage')) {
    return 'drinks';
  }

  if (normalized.includes('dessert') || normalized.includes('cake') || normalized.includes('brownie') || normalized.includes('muffin') || normalized.includes('cookie') || normalized.includes('sweet') || normalized.includes('pastry')) {
    return 'desserts';
  }

  if (normalized.includes('snack') || normalized.includes('chips') || normalized.includes('trail') || normalized.includes('bar') || normalized.includes('nuts') || normalized.includes('pretzel')) {
    return 'snacks';
  }

  if (normalized.includes('food') || normalized.includes('meal') || normalized.includes('sandwich') || normalized.includes('burger') || normalized.includes('salad') || normalized.includes('pizza') || normalized.includes('croissant') || normalized.includes('bread') || normalized.includes('wrap')) {
    return 'food';
  }

  return 'other';
};

const iconForProduct = (name: string, category: string): string => {
  const normalized = normalize(name);

  if (category === 'drinks') {
    if (normalized.includes('tea')) return '🍵';
    if (normalized.includes('juice')) return '🍊';
    if (normalized.includes('latte')) return '🥛';
    if (normalized.includes('cappuccino') || normalized.includes('americano') || normalized.includes('coffee')) return '☕';
    return '🫗';
  }

  if (category === 'food') {
    if (normalized.includes('salad')) return '🥗';
    if (normalized.includes('pizza')) return '🍕';
    if (normalized.includes('burger')) return '🍔';
    if (normalized.includes('croissant')) return '🥐';
    return '🥪';
  }

  if (category === 'snacks') {
    if (normalized.includes('trail')) return '🥜';
    if (normalized.includes('bar')) return '🍫';
    return '🥨';
  }

  if (category === 'desserts') {
    if (normalized.includes('brownie')) return '🍩';
    if (normalized.includes('muffin')) return '🧁';
    return '🍰';
  }

  return '◼';
};

const buildCatalog = (products: LocalProduct[], categories: LocalCategory[]): CatalogItem[] => {
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  return products.map((product) => {
    const linkedCategory = product.category_id ? categoryById.get(product.category_id) : null;
    const categoryLabel = linkedCategory?.name ?? 'Unassigned';
    const categoryKey = linkedCategory?.id ?? 'unassigned';
    const iconCategory = toDisplayCategory(`${categoryLabel} ${product.name}`);
    const displayPriceCents = product.selling_price_cents > 0 ? product.selling_price_cents : product.price_cents;
    const displayCostCents = product.cost_price_cents > 0 ? product.cost_price_cents : Math.max(0, Math.round(displayPriceCents * 0.6));

    return {
      key: `product:${product.id}`,
      productId: product.id,
      name: product.name,
      priceCents: displayPriceCents,
      costCents: displayCostCents,
      sellingPriceCents: displayPriceCents,
      stockCount: product.stock_count,
      inventoryTracking: product.inventory_tracking,
      categoryKey,
      categoryLabel,
      icon: iconForProduct(product.name, iconCategory),
    } satisfies CatalogItem;
  });
};

export const PosLandscapeScreen = () => {
  const { profile, signOut } = useAuthStore();
  const { palette } = useThemeStore();
  const [snapshot, setSnapshot] = useState<PosSnapshot | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'qr'>('cash');
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [feedbackMessage, setFeedbackMessage] = useState<string>('Loading local POS data...');
  const [chargeOverride, setChargeOverride] = useState<string | null>(null);
  const [clockLabel, setClockLabel] = useState<string>('');

  const [productImageUrlById, setProductImageUrlById] = useState<Record<string, string | null>>({});
  const [activeShift, setActiveShift] = useState<Awaited<ReturnType<typeof loadActiveShift>>>(null);
  const [shiftSummary, setShiftSummary] = useState<ShiftSummary | null>(null);
  const [showOpeningModal, setShowOpeningModal] = useState(false);
  const [openingCashInput, setOpeningCashInput] = useState('');
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [showPayInOutModal, setShowPayInOutModal] = useState(false);
  const [payInOutType, setPayInOutType] = useState<'pay_in' | 'pay_out'>('pay_in');
  const [payInOutAmount, setPayInOutAmount] = useState('');
  const [payInOutReason, setPayInOutReason] = useState('');
  const [payInOutError, setPayInOutError] = useState<string | null>(null);
  const [showEodModal, setShowEodModal] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [denominationCounts, setDenominationCounts] = useState<Record<number, string>>(
    Object.fromEntries(DENOMINATIONS.map((value) => [value, '0'])) as Record<number, string>
  );
  const [isClosingShift, setIsClosingShift] = useState(false);
  const [eodError, setEodError] = useState<string | null>(null);
  const chargeResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  const tenantId = profile?.tenant_id;

  const loadPosData = useCallback(async (feedbackMessage?: string) => {
    if (!tenantId) {
      return;
    }

    const [products, categories, nextSnapshot] = await Promise.all([
      listLocalProducts(tenantId),
      listLocalCategories(tenantId),
      getPosSnapshot(tenantId),
    ]);

    const imagePreviewEntries = await Promise.all(
      products.map(async (product) => [product.id, await resolveProductImageUrl(product.image_path)] as const)
    );

    setCatalog(buildCatalog(products, categories));
    setProductImageUrlById(Object.fromEntries(imagePreviewEntries));
    setPendingSyncCount(nextSnapshot.pendingMutations);
    setSnapshot(nextSnapshot);
    setFeedbackMessage(feedbackMessage ?? (products.length > 0 ? 'Local data is ready.' : 'No local products found in database.'));
  }, [tenantId]);

  const loadShiftState = useCallback(async () => {
    if (!tenantId) {
      return;
    }

    const currentShift = await loadActiveShift(tenantId);
    setActiveShift(currentShift);

    if (!currentShift) {
      setShiftSummary(null);
      setShowOpeningModal(true);
      return;
    }

    const summary = await getShiftSummary(currentShift);
    setShiftSummary(summary);
    setShowOpeningModal(false);
  }, [tenantId]);

  useEffect(() => {
    void loadPosData();
  }, [loadPosData]);

  useEffect(() => {
    void loadShiftState();
  }, [loadShiftState]);

  useEffect(() => {
    if (!tenantId) {
      setPendingSyncCount(0);
      return;
    }

    let isCancelled = false;

    const refreshPendingSyncCount = async () => {
      try {
        const nextPendingSyncCount = await getPendingMutationCount(tenantId);
        if (!isCancelled) {
          setPendingSyncCount(nextPendingSyncCount);
        }
      } catch {
        if (!isCancelled) {
          setPendingSyncCount(0);
        }
      }
    };

    void refreshPendingSyncCount();
    const timer = setInterval(refreshPendingSyncCount, 5000);

    return () => {
      isCancelled = true;
      clearInterval(timer);
    };
  }, [tenantId]);

  useEffect(() => {
    let isCancelled = false;

    const checkConnectivity = async () => {
      try {
        if (!supabase) {
          setIsOnline(false);
          return;
        }

        const { error } = await supabase.from('tenants').select('id', { count: 'exact', head: true });
        if (!isCancelled) {
          setIsOnline(!error);
        }
      } catch {
        if (!isCancelled) {
          setIsOnline(false);
        }
      }
    };

    void checkConnectivity();
    const timer = setInterval(checkConnectivity, 10000);

    return () => {
      isCancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClockLabel(
        now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };

    updateClock();
    const timer = setInterval(updateClock, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (chargeResetRef.current) {
        clearTimeout(chargeResetRef.current);
      }
    };
  }, []);

  const productsByCategory = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = catalog.filter((product) => {
      return !query ||
        product.name.toLowerCase().includes(query) ||
        product.categoryLabel.toLowerCase().includes(query);
    });

    const groups: Record<string, { label: string; products: CatalogItem[] }> = {};
    filtered.forEach((product) => {
      const key = product.categoryKey || 'uncategorized';
      if (!groups[key]) {
        groups[key] = { label: product.categoryLabel || 'Uncategorized', products: [] };
      }
      groups[key].products.push(product);
    });

    return Object.entries(groups).map(([key, value]) => ({ key, ...value }));
  }, [catalog, searchQuery]);



  const cartLines = useMemo(() => Object.values(cart), [cart]);

  const totals = useMemo(() => {
    const grandTotalCents = cartLines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
    const taxCents = Math.round((grandTotalCents * TAX_RATE) / (1 + TAX_RATE));
    const subtotalCents = Math.max(0, grandTotalCents - taxCents);

    return {
      subtotalCents,
      taxCents,
      grandTotalCents,
      totalItems: cartLines.reduce((sum, line) => sum + line.quantity, 0),
    };
  }, [cartLines]);



  const actualCashCents = useMemo(() => {
    return DENOMINATIONS.reduce((sum, denomination) => {
      const rawCount = denominationCounts[denomination] ?? '0';
      const count = Number(rawCount.replace(/[^0-9]/g, '')) || 0;
      return sum + denomination * 100 * count;
    }, 0);
  }, [denominationCounts]);

  const expectedCashCents = shiftSummary?.expectedCashCents ?? 0;
  const varianceCents = actualCashCents - expectedCashCents;
  const varianceColor = varianceCents === 0 ? palette.success : varianceCents < 0 ? palette.danger : palette.accent;

  const handleAddProduct = useCallback((product: CatalogItem) => {
    setCart((current) => {
      const existing = current[product.key];

      if (!existing) {
        return {
          ...current,
          [product.key]: { ...product, quantity: 1 },
        };
      }

      return {
        ...current,
        [product.key]: {
          ...existing,
          quantity: existing.quantity + 1,
        },
      };
    });
  }, []);



  const handleOpenShift = useCallback(async () => {
    if (!tenantId) {
      return;
    }

    const startingCashCents = parsePesoInputToCents(openingCashInput);
    if (!openingCashInput.trim()) {
      setOpeningError('Starting cash is required.');
      return;
    }

    setOpeningError(null);

    try {
      const createdShift = await openShift({
        tenantId,
        cashierProfileId: profile?.id ?? null,
        startingCashCents,
      });

      setActiveShift(createdShift);
      setShiftSummary(await getShiftSummary(createdShift));
      setShowOpeningModal(false);
      setOpeningCashInput('');
      setFeedbackMessage(`Shift opened with ${money(startingCashCents)} starting float.`);
    } catch (error) {
      setOpeningError(error instanceof Error ? error.message : 'Unable to open shift.');
    }
  }, [openingCashInput, profile?.id, tenantId]);

  const handleRecordPayInOut = useCallback(async () => {
    if (!tenantId || !activeShift) {
      return;
    }

    const amountCents = parsePesoInputToCents(payInOutAmount);
    if (!payInOutAmount.trim() || amountCents <= 0) {
      setPayInOutError('Enter a valid amount.');
      return;
    }

    setPayInOutError(null);
    await recordShiftEvent({
      shiftId: activeShift.id,
      tenantId,
      cashierProfileId: profile?.id ?? null,
      type: payInOutType,
      amountCents,
      reason: payInOutReason.trim() || (payInOutType === 'pay_in' ? 'Pay-in' : 'Payout'),
    });

    setPayInOutAmount('');
    setPayInOutReason('');
    setShowPayInOutModal(false);
    await loadShiftState();
  }, [activeShift, loadShiftState, payInOutAmount, payInOutReason, payInOutType, profile?.id, tenantId]);

  const handleCloseShift = useCallback(async () => {
    if (!tenantId || !activeShift) {
      setEodError('Missing shift or tenant data.');
      return;
    }

    if (!shiftSummary) {
      setEodError('Shift summary not loaded. Please wait or try again.');
      return;
    }

    setIsClosingShift(true);
    setEodError(null);

    try {
      const breakdown = Object.fromEntries(
        DENOMINATIONS.map((value) => [
          String(value),
          Number((denominationCounts[value] ?? '0').replace(/[^0-9]/g, '')) || 0,
        ])
      );

      await closeShift({
        shift: activeShift,
        summary: shiftSummary,
        actualCashCents,
        denominationBreakdown: breakdown,
      });

      const reportLines = [
        'TAKOPOS Z-REPORT',
        `Shift: ${activeShift.id.slice(0, 8).toUpperCase()}`,
        `Opened: ${new Date(activeShift.opened_at).toLocaleString('en-PH')}`,
        `Closed: ${new Date().toLocaleString('en-PH')}`,
        `Starting Float: ${money(shiftSummary.startingCashCents)}`,
        `Cash Sales: ${money(shiftSummary.totalCashSalesCents)}`,
        `Card Sales: ${money(shiftSummary.paymentsSummary.card)}`,
        `QR Sales: ${money(shiftSummary.paymentsSummary.qr)}`,
        `Pay-ins: ${money(shiftSummary.payInsCents)}`,
        `Payouts: ${money(shiftSummary.payoutsCents)}`,
        `Expected Cash: ${money(expectedCashCents)}`,
        `Actual Cash: ${money(actualCashCents)}`,
        `Variance: ${money(varianceCents)}`,
      ];

      void printZReport(reportLines.join('\n'));
      void openCashDrawer();

      setDenominationCounts(Object.fromEntries(DENOMINATIONS.map((value) => [value, '0'])) as Record<number, string>);
      setShowEodModal(false);
      await loadShiftState();
      setFeedbackMessage('Shift closed. Opening float required for the next shift.');
    } catch (error) {
      setEodError(error instanceof Error ? error.message : 'Failed to close shift. Please try again.');
    } finally {
      setIsClosingShift(false);
    }
  }, [
    activeShift,
    actualCashCents,
    denominationCounts,
    expectedCashCents,
    loadShiftState,
    shiftSummary,
    tenantId,
    varianceCents,
  ]);


  const handleUpdateQuantity = useCallback((key: string, delta: number) => {
    setCart((current) => {
      const existing = current[key];

      if (!existing) {
        return current;
      }

      const nextQuantity = existing.quantity + delta;

      if (nextQuantity <= 0) {
        const { [key]: removed, ...rest } = current;
        void removed;
        return rest;
      }

      return {
        ...current,
        [key]: {
          ...existing,
          quantity: nextQuantity,
        },
      };
    });
  }, []);

  const handleSetQuantity = useCallback((key: string, value: string) => {
    const nextQuantity = value === '' ? 0 : Number(value.replace(/[^0-9]/g, ''));

    setCart((current) => {
      const existing = current[key];
      if (!existing) return current;

      return {
        ...current,
        [key]: {
          ...existing,
          quantity: nextQuantity,
        },
      };
    });
  }, []);

  const handleRemoveFromCart = useCallback((key: string) => {
    setCart((current) => {
      if (!current[key]) {
        return current;
      }

      const { [key]: removed, ...rest } = current;
      void removed;
      return rest;
    });
  }, []);

  const handleCharge = useCallback(async () => {
    if (!tenantId || totals.grandTotalCents <= 0 || cartLines.length === 0) {
      return;
    }

    if (!activeShift) {
      setFeedbackMessage('Open a shift before processing transactions.');
      return;
    }



    try {
      await createSaleLocalFirst({
        tenant_id: tenantId,
        cashier_profile_id: profile?.id ?? null,
        total_cents: totals.grandTotalCents,
        expenses_cents: 0,
        payment_method: paymentMethod,
        items: cartLines.map((line) => ({
          tenant_id: tenantId,
          product_id: line.productId,
          quantity: line.quantity,
          unit_price_cents: line.sellingPriceCents,
          selling_price_cents: line.sellingPriceCents,
          cost_price_cents: line.costCents,
        })),
      });

      setCart({});
      setChargeOverride('Payment complete!');
      setFeedbackMessage('Sale saved locally and queued for sync.');

      if (chargeResetRef.current) {
        clearTimeout(chargeResetRef.current);
      }

      chargeResetRef.current = setTimeout(() => {
        setChargeOverride(null);
      }, 2000);

      await loadPosData('Sale saved locally and queued for sync.');
      await loadShiftState();
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : 'Failed to save local sale');
    }
  }, [activeShift, cartLines, loadPosData, loadShiftState, paymentMethod, profile?.id, tenantId, totals.grandTotalCents]);

  const chargeLabel = chargeOverride ?? `Charge ${money(totals.grandTotalCents)}`;
  const catalogCount = snapshot?.productsCount ?? catalog.length;
  const salesCount = snapshot?.salesCount ?? 0;
  const connectivityLabel = isOnline ? 'Terminal online' : 'Terminal offline';
  const syncQueueLabel = pendingSyncCount > 0 ? `${pendingSyncCount} queued for sync` : 'Sync queue clear';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View style={[styles.shell, { backgroundColor: palette.background }]}>
        <View style={[styles.bgGlowPrimary, { backgroundColor: palette.accent }]} />
        <View style={[styles.bgGlowSecondary, { backgroundColor: palette.primary }]} />

        <View style={styles.sidebar}>
          <View style={[styles.logoTile, { backgroundColor: palette.primary }]}>
            <Text style={styles.logoLetter}>P</Text>
          </View>

          <View style={styles.sidebarDivider} />

          <View style={[styles.sidebarButton, styles.sidebarButtonActive, { backgroundColor: `${palette.primary}22` }]}>
            <Text style={[styles.sidebarGlyph, { color: palette.primary }]}>▣</Text>
          </View>

          <View style={styles.sidebarSpacer} />

          <Pressable style={styles.sidebarButton} onPress={signOut}>
            <Text style={styles.sidebarGlyph}>⎋</Text>
          </Pressable>
        </View>

        <View style={styles.centerPane}>
          <View style={styles.centerHeader}>
            <View style={styles.searchWrap}>
              <Text style={styles.searchGlyph}>⌕</Text>
              <TextInput
                style={[styles.searchInput, { color: palette.text, backgroundColor: palette.surface }]}
                placeholder="Search products, SKU..."
                placeholderTextColor={palette.mutedText}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
            </View>

            <View style={styles.tabStrip}>
              <Text style={[styles.sectionTitle, { color: palette.text }]}>Product Catalog</Text>
            </View>
          </View>

          <ScrollView style={styles.catalogScroll} contentContainerStyle={styles.catalogContent} showsVerticalScrollIndicator={false}>
            {productsByCategory.length === 0 ? (
              <View style={styles.emptyCatalogState}>
                <Text style={[styles.emptyCatalogGlyph, { color: palette.mutedText }]}>◫</Text>
                <Text style={[styles.emptyCatalogTitle, { color: palette.text }]}>No products found</Text>
                <Text style={[styles.emptyCatalogBody, { color: palette.mutedText }]}>No product rows are available in the local database yet.</Text>
              </View>
            ) : (
              productsByCategory.map((group) => (
                <View key={group.key} style={styles.categorySection}>
                  <Text style={[styles.categoryHeaderLabel, { color: palette.primary }]}>{group.label.toUpperCase()}</Text>
                  <View style={styles.categoryGrid}>
                    {group.products.map((product) => {
                      const inCart = Boolean(cart[product.key]);
                      const stockText = product.inventoryTracking
                        ? product.stockCount < 20
                          ? `⚠ ${Math.max(0, Math.round(product.stockCount))} left`
                          : 'In stock'
                        : 'Unlimited';

                      return (
                        <Pressable
                          key={product.key}
                          style={[
                            styles.productCard,
                            {
                              backgroundColor: palette.surface,
                              borderColor: inCart ? palette.primary : (product.inventoryTracking && product.stockCount < 10) ? palette.accent : `${palette.text}10`,
                              borderWidth: (product.inventoryTracking && product.stockCount < 10) ? 2 : 1,
                            },
                          ]}
                          onPress={() => handleAddProduct(product)}
                        >
                          {(product.inventoryTracking && product.stockCount < 10) && (
                            <View style={[styles.lowStockBadge, { backgroundColor: palette.accent }]}>
                              <Text style={styles.lowStockBadgeText}>LOW</Text>
                            </View>
                          )}
                          <View style={styles.productBadgeWrap}>
                            <Text style={[styles.productBadge, { color: palette.primary }]}>✓</Text>
                          </View>
                          <View style={styles.productIconWrap}>
                            {productImageUrlById[product.productId ?? ''] ? (
                              <Image source={{ uri: productImageUrlById[product.productId ?? ''] ?? undefined }} style={styles.productImage} />
                            ) : (
                              <Text style={styles.productIcon}>{product.icon}</Text>
                            )}
                          </View>
                          <Text style={[styles.productName, { color: palette.text }]} numberOfLines={2}>
                            {product.name}
                          </Text>
                          <Text style={[styles.productPrice, { color: palette.text }]}>{money(product.priceCents)}</Text>
                          <Text style={[styles.productStock, { color: (product.inventoryTracking && product.stockCount < 10) ? palette.accent : palette.mutedText }]}>{stockText}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          <View style={[styles.statusBar, { borderTopColor: `${palette.text}12` }]}>
            <View style={styles.statusItem}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: isOnline ? palette.success : palette.accent },
                ]}
              />
              <Text style={[styles.statusText, { color: palette.mutedText }]}>{connectivityLabel}</Text>
            </View>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: pendingSyncCount > 0 ? palette.accent : palette.success }]} />
              <Text style={[styles.statusText, { color: palette.mutedText }]}>{syncQueueLabel}</Text>
            </View>
            <View style={styles.statusItem}>
              <Text style={[styles.statusText, styles.monoText, { color: palette.mutedText }]}>{clockLabel}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.orderPane, { backgroundColor: palette.surface, borderLeftColor: `${palette.text}12` }]}>
          <View style={[styles.orderHeader, { borderBottomColor: `${palette.text}12` }]}>
            <Text style={[styles.selectedItemsTitle, { color: palette.text }]}>SELECTED ITEMS</Text>
            <View style={[styles.orderCount, { backgroundColor: `${palette.primary}22` }]}>
              <Text style={[styles.orderCountText, { color: palette.primary }]}>
                {totals.totalItems} {totals.totalItems === 1 ? 'item' : 'items'}
              </Text>
            </View>
          </View>

          <ScrollView style={styles.orderScroll} contentContainerStyle={styles.orderScrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.orderStatsRow}>
              <View style={[styles.orderStatPill, { backgroundColor: `${palette.text}08`, borderColor: `${palette.text}10` }]}>
                <Text style={[styles.orderStatLabel, { color: palette.mutedText }]}>Products</Text>
                <Text style={[styles.orderStatValue, { color: palette.text }]}>{catalogCount}</Text>
              </View>
              <View style={[styles.orderStatPill, { backgroundColor: `${palette.text}08`, borderColor: `${palette.text}10` }]}>
                <Text style={[styles.orderStatLabel, { color: palette.mutedText }]}>Sales</Text>
                <Text style={[styles.orderStatValue, { color: palette.text }]}>{salesCount}</Text>
              </View>
            </View>

            <View style={[styles.shiftCard, { borderColor: `${palette.text}12`, backgroundColor: `${palette.background}F2` }]}>
              <View style={styles.shiftHeaderRow}>
                <Text style={[styles.shiftTitle, { color: palette.text }]}>Shift Status</Text>
                <Text style={[styles.shiftBadge, { color: activeShift ? palette.success : palette.danger }]}>
                  {activeShift ? 'Open' : 'Closed'}
                </Text>
              </View>
              {activeShift ? (
                <>
                  <Text style={[styles.shiftMeta, { color: palette.mutedText }]}>Opened {new Date(activeShift.opened_at).toLocaleTimeString('en-PH')}</Text>
                  <View style={styles.shiftTotalsRow}>
                    <Text style={[styles.shiftLabel, { color: palette.mutedText }]}>Starting Float</Text>
                    <Text style={[styles.shiftValue, { color: palette.text }]}>{money(shiftSummary?.startingCashCents ?? 0)}</Text>
                  </View>
                  <View style={styles.shiftTotalsRow}>
                    <Text style={[styles.shiftLabel, { color: palette.mutedText }]}>Expected Cash</Text>
                    <Text style={[styles.shiftValue, { color: palette.text }]}>{money(expectedCashCents)}</Text>
                  </View>
                </>
              ) : (
                <Text style={[styles.shiftMeta, { color: palette.mutedText }]}>Open a shift to start taking orders.</Text>
              )}
              <View style={styles.shiftActionRow}>
                <Pressable
                  onPress={() => {
                    setPayInOutType('pay_out');
                    setShowPayInOutModal(true);
                  }}
                  disabled={!activeShift}
                  style={({ pressed }) => [
                    styles.shiftActionButton,
                    {
                      borderColor: `${palette.text}22`,
                      opacity: pressed ? 0.86 : activeShift ? 1 : 0.4,
                    },
                  ]}
                >
                  <Text style={[styles.shiftActionText, { color: palette.text }]}>Expenses</Text>
                </Pressable>
                <Pressable
                  onPress={() => setShowEodModal(true)}
                  disabled={!activeShift}
                  style={({ pressed }) => [
                    styles.shiftCloseButton,
                    {
                      backgroundColor: activeShift ? palette.accent : `${palette.accent}66`,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                >
                  <Text style={styles.shiftCloseText}>Close Register</Text>
                </Pressable>
              </View>
            </View>

            {cartLines.length === 0 ? (
              <View style={styles.emptyOrderState}>
                <Text style={[styles.emptyOrderGlyph, { color: palette.mutedText }]}>◔</Text>
                <Text style={[styles.emptyOrderText, { color: palette.mutedText }]}>Tap a product to add it to this order</Text>
              </View>
            ) : (
              cartLines.map((line) => (
                <View key={line.key} style={[styles.orderItem, { borderBottomColor: `${palette.text}08` }]}>
                  <View style={[styles.orderItemIcon, { backgroundColor: `${palette.text}08` }]}>
                    <Text style={styles.orderItemIconText}>{line.icon}</Text>
                  </View>
                  <View style={styles.orderItemInfo}>
                    <Text style={[styles.orderItemName, { color: palette.text }]} numberOfLines={1}>
                      {line.name}
                    </Text>
                    <Text style={[styles.orderItemSub, { color: palette.mutedText }]}>
                      {money(line.priceCents)} each
                    </Text>
                  </View>
                  <View style={styles.orderQty}>
                    <Pressable style={[styles.qtyButton, { backgroundColor: `${palette.text}08`, borderColor: `${palette.text}10` }]} onPress={() => handleUpdateQuantity(line.key, -1)}>
                      <Text style={[styles.qtyButtonText, { color: palette.text }]}>−</Text>
                    </Pressable>
                    <TextInput
                      style={[styles.qtyValue, { color: palette.text }]}
                      value={String(line.quantity || '')}
                      onChangeText={(val) => handleSetQuantity(line.key, val)}
                      keyboardType="number-pad"
                      selectTextOnFocus
                      onBlur={() => {
                        if (line.quantity <= 0) {
                          handleRemoveFromCart(line.key);
                        }
                      }}
                    />
                    <Pressable style={[styles.qtyButton, { backgroundColor: `${palette.text}08`, borderColor: `${palette.text}10` }]} onPress={() => handleUpdateQuantity(line.key, 1)}>
                      <Text style={[styles.qtyButtonText, { color: palette.text }]}>+</Text>
                    </Pressable>
                  </View>
                  <Text style={[styles.orderItemTotal, { color: palette.text }]}>{money(line.priceCents * line.quantity)}</Text>
                  <Pressable style={[styles.removeItemButton, { borderColor: `${palette.danger}55` }]} onPress={() => handleRemoveFromCart(line.key)}>
                    <Text style={[styles.removeItemButtonText, { color: palette.danger }]}>Remove</Text>
                  </Pressable>
                </View>
              ))
            )}

            <View style={[styles.totalsBlock, { borderTopColor: `${palette.text}12` }]}>
            </View>

            <View style={[styles.paymentBlock, { borderTopColor: `${palette.text}12` }]}>

              <View style={styles.paymentMethods}>
                {[
                  { key: 'cash', label: 'Cash', glyph: '₱' },
                  { key: 'qr', label: 'G-Cash / QR', glyph: '▣' },
                ].map((method) => {
                  const active = paymentMethod === method.key;

                  return (
                    <Pressable
                      key={method.key}
                      style={[
                        styles.paymentMethod,
                        {
                          backgroundColor: active ? `${palette.primary}20` : palette.surface,
                          borderColor: active ? palette.primary : `${palette.text}12`,
                        },
                      ]}
                      onPress={() => setPaymentMethod(method.key as 'cash' | 'card' | 'qr')}
                    >
                      <Text style={[styles.paymentMethodGlyph, { color: active ? palette.primary : palette.mutedText }]}>{method.glyph}</Text>
                      <Text style={[styles.paymentMethodText, { color: active ? palette.primary : palette.mutedText }]}>{method.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          <View style={[styles.chargeBlock, { borderTopColor: `${palette.text}12` }]}>
            <Pressable
              style={[
                styles.chargeButton,
                {
                  backgroundColor: totals.grandTotalCents > 0 && activeShift ? palette.primary : `${palette.primary}66`,
                },
              ]}
              onPress={handleCharge}
              disabled={totals.grandTotalCents <= 0 || !activeShift}
            >
              <Text style={styles.chargeButtonGlyph}>→</Text>
              <Text style={styles.chargeButtonText}>{`Charge ${money(totals.grandTotalCents)}`}</Text>
            </Pressable>

            <Text style={[styles.feedbackText, { color: palette.mutedText }]}>{feedbackMessage}</Text>
          </View>
        </View>
      </View>

      <Modal visible={showOpeningModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: palette.surface }]}>
            <Text style={[styles.modalTitle, { color: palette.text }]}>Opening Float</Text>
            <Text style={[styles.modalHint, { color: palette.mutedText }]}>Enter the starting cash for this shift to unlock the register.</Text>
            <TextInput
              style={[styles.modalInput, { color: palette.text, borderColor: `${palette.text}22`, backgroundColor: palette.background }]}
              value={openingCashInput}
              onChangeText={(value) => {
                setOpeningCashInput(normalizeCurrencyInput(value));
                setOpeningError(null);
              }}
              placeholder="0.00"
              placeholderTextColor={palette.mutedText}
              keyboardType="decimal-pad"
            />
            {openingError ? <Text style={[styles.modalError, { color: palette.danger }]}>{openingError}</Text> : null}
            <Pressable style={[styles.primaryModalButton, { backgroundColor: palette.primary }]} onPress={handleOpenShift}>
              <Text style={[styles.primaryModalText, { color: '#FFFFFF' }]}>Start Shift</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showPayInOutModal} transparent animationType="fade" onRequestClose={() => setShowPayInOutModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: palette.surface }]}>
            <Text style={[styles.modalTitle, { color: palette.text }]}>Log Expense</Text>
            <Text style={[styles.modalHint, { color: palette.mutedText }]}>Record a cash deduction from the drawer for store expenses.</Text>
            <TextInput
              style={[styles.modalInput, { color: palette.text, borderColor: `${palette.text}22`, backgroundColor: palette.background }]}
              value={payInOutAmount}
              onChangeText={(value) => {
                setPayInOutAmount(normalizeCurrencyInput(value));
                setPayInOutError(null);
              }}
              placeholder="Amount"
              placeholderTextColor={palette.mutedText}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={[styles.modalInput, { color: palette.text, borderColor: `${palette.text}22`, backgroundColor: palette.background }]}
              value={payInOutReason}
              onChangeText={setPayInOutReason}
              placeholder="Reason (e.g., Bought ice)"
              placeholderTextColor={palette.mutedText}
            />
            {payInOutError ? <Text style={[styles.modalError, { color: palette.danger }]}>{payInOutError}</Text> : null}
            <View style={styles.modalActionRow}>
              <Pressable style={[styles.ghostModalButton, { borderColor: `${palette.text}22` }]} onPress={() => setShowPayInOutModal(false)}>
                <Text style={[styles.ghostModalText, { color: palette.text }]}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.primaryModalButton, { backgroundColor: palette.primary }]} onPress={handleRecordPayInOut}>
                <Text style={styles.primaryModalText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showEodModal} transparent animationType="slide" onRequestClose={() => setShowEodModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.eodCard, { backgroundColor: palette.surface }]}>
            <ScrollView
              style={styles.eodScrollView}
              contentContainerStyle={styles.eodScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.modalTitle, { color: palette.text }]}>End-of-Day Reconciliation</Text>
              <Text style={[styles.modalHint, { color: palette.mutedText }]}>Count the drawer and confirm the totals before closing the shift.</Text>

              <View style={[styles.eodSummaryCard, { backgroundColor: `${palette.background}F0`, borderColor: `${palette.text}12` }]}
              >
                <View style={styles.eodRow}>
                  <Text style={[styles.eodLabel, { color: palette.mutedText }]}>Expected Cash</Text>
                  <Text style={[styles.eodValue, { color: palette.text }]}>{money(expectedCashCents)}</Text>
                </View>
                <View style={styles.eodRow}>
                  <Text style={[styles.eodLabel, { color: palette.mutedText }]}>Actual Cash</Text>
                  <Text style={[styles.eodValue, { color: palette.text }]}>{money(actualCashCents)}</Text>
                </View>
                <View style={styles.eodRow}>
                  <Text style={[styles.eodLabel, { color: palette.mutedText }]}>Variance</Text>
                  <Text style={[styles.eodValue, { color: varianceColor }]}>{money(varianceCents)}</Text>
                </View>
              </View>

              <Text style={[styles.sectionLabel, { color: palette.mutedText }]}>Denomination Count</Text>
              <View style={styles.denominationGrid}>
                {DENOMINATIONS.map((value) => (
                  <View key={value} style={[styles.denominationCell, { borderColor: `${palette.text}12`, backgroundColor: `${palette.background}F2` }]}
                  >
                    <Text style={[styles.denominationLabel, { color: palette.mutedText }]}>{money(value * 100)}</Text>
                    <TextInput
                      style={[styles.denominationInput, { color: palette.text, borderColor: `${palette.text}22` }]}
                      keyboardType="number-pad"
                      value={denominationCounts[value] ?? '0'}
                      onChangeText={(nextValue) =>
                        setDenominationCounts((current) => ({
                          ...current,
                          [value]: nextValue.replace(/[^0-9]/g, '') || '0',
                        }))
                      }
                    />
                  </View>
                ))}
              </View>

              <Text style={[styles.sectionLabel, { color: palette.mutedText }]}>Sales Summary</Text>
              <View style={[styles.eodSummaryCard, { backgroundColor: `${palette.background}F0`, borderColor: `${palette.text}12` }]}>
                <View style={styles.eodRow}>
                  <Text style={[styles.eodLabel, { color: palette.mutedText }]}>Cash Sales</Text>
                  <Text style={[styles.eodValue, { color: palette.text }]}>{money(shiftSummary?.totalCashSalesCents ?? 0)}</Text>
                </View>
                <View style={styles.eodRow}>
                  <Text style={[styles.eodLabel, { color: palette.mutedText }]}>Card Sales</Text>
                  <Text style={[styles.eodValue, { color: palette.text }]}>{money(shiftSummary?.paymentsSummary.card ?? 0)}</Text>
                </View>
                <View style={styles.eodRow}>
                  <Text style={[styles.eodLabel, { color: palette.mutedText }]}>QR Sales</Text>
                  <Text style={[styles.eodValue, { color: palette.text }]}>{money(shiftSummary?.paymentsSummary.qr ?? 0)}</Text>
                </View>
              </View>
            </ScrollView>

              {eodError ? <Text style={[styles.modalError, { color: palette.danger, marginBottom: 12 }]}>{eodError}</Text> : null}
              <View style={styles.modalActionRow}>
                <Pressable
                  style={[styles.ghostModalButton, { borderColor: `${palette.text}22` }]}
                  onPress={() => {
                    setShowEodModal(false);
                    setEodError(null);
                  }}
                  disabled={isClosingShift}
                >
                  <Text style={[styles.ghostModalText, { color: palette.text }]}>Back</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.primaryModalButton,
                    {
                      backgroundColor: isClosingShift ? `${palette.accent}88` : palette.accent,
                    }
                  ]}
                  onPress={handleCloseShift}
                  disabled={isClosingShift}
                >
                  <Text style={styles.primaryModalText}>{isClosingShift ? 'Closing...' : 'Confirm Close'}</Text>
                </Pressable>
              </View>

          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  shell: {
    flex: 1,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  bgGlowPrimary: {
    position: 'absolute',
    left: -120,
    top: -110,
    width: 260,
    height: 260,
    borderRadius: 999,
    opacity: 0.08,
  },
  bgGlowSecondary: {
    position: 'absolute',
    right: -80,
    top: 20,
    width: 180,
    height: 180,
    borderRadius: 999,
    opacity: 0.06,
  },
  sidebar: {
    width: 64,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 7,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(255,255,255,0.08)',
  },
  logoTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  logoLetter: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  shiftCard: {
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  shiftHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shiftTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  shiftBadge: {
    fontSize: 12,
    fontWeight: '600',
  },
  shiftMeta: {
    fontSize: 12,
  },
  shiftTotalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  shiftLabel: {
    fontSize: 12,
  },
  shiftValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  shiftActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  shiftActionButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  shiftActionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  shiftCloseButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  shiftCloseText: {
    color: '#0b0b0b',
    fontSize: 12,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(12,14,20,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  eodCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 18,
    padding: 18,
    gap: 12,
    height: '90%',
    maxHeight: '90%',
  },
  eodScrollView: {
    flex: 1,
    minHeight: 0,
  },
  eodScrollContent: {
    gap: 12,
    flexGrow: 1,
    paddingBottom: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalHint: {
    fontSize: 12,
    lineHeight: 17,
  },
  modalInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  modalError: {
    fontSize: 12,
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  primaryModalButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryModalText: {
    color: '#0b0b0b',
    fontWeight: '700',
  },
  ghostModalButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  ghostModalText: {
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  toggleChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  eodSummaryCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  eodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eodLabel: {
    fontSize: 12,
  },
  eodValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  denominationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  denominationCell: {
    width: '30%',
    minWidth: 90,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 10,
    gap: 6,
  },
  denominationLabel: {
    fontSize: 11,
  },
  denominationInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 13,
  },
  sidebarDivider: {
    width: 32,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginVertical: 6,
  },
  sidebarButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  sidebarButtonActive: {
    borderWidth: 0,
  },
  sidebarGlyph: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 15,
    fontWeight: '700',
  },
  sidebarSpacer: {
    flex: 1,
  },
  centerPane: {
    flex: 1,
    minWidth: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(255,255,255,0.08)',
  },
  centerHeader: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  searchWrap: {
    flex: 1,
    position: 'relative',
    justifyContent: 'center',
  },
  searchGlyph: {
    position: 'absolute',
    left: 12,
    zIndex: 2,
    color: 'rgba(255,255,255,0.28)',
    fontSize: 16,
    fontWeight: '700',
  },
  searchInput: {
    height: 36,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingLeft: 34,
    paddingRight: 12,
    fontSize: 13,
  },
  tabStrip: {
    gap: 4,
    paddingLeft: 4,
  },
  categoryTab: {
    height: 30,
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  categoryTabText: {
    fontSize: 12,
    fontWeight: '600',
  },
  catalogScroll: {
    flex: 1,
  },
  catalogContent: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  categorySection: {
    marginBottom: 24,
  },
  categoryHeaderLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 12,
    marginLeft: 4,
    opacity: 0.8,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignContent: 'flex-start',
  },
  productCard: {
    flexGrow: 1,
    flexBasis: 132,
    maxWidth: 170,
    minHeight: 148,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 12,
    position: 'relative',
  },
  productBadgeWrap: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
  },
  productBadge: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  productIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginBottom: 10,
  },
  productIcon: {
    fontSize: 22,
  },
  productImage: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  productName: {
    fontSize: 12.5,
    fontWeight: '600',
    lineHeight: 16,
    marginBottom: 7,
  },
  productPrice: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  productStock: {
    fontSize: 11,
    fontWeight: '500',
  },
  emptyCatalogState: {
    flex: 1,
    minHeight: 220,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 36,
  },
  emptyCatalogGlyph: {
    fontSize: 28,
    fontWeight: '700',
  },
  emptyCatalogTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  emptyCatalogBody: {
    fontSize: 12,
    textAlign: 'center',
  },
  statusBar: {
    minHeight: 34,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
  },
  monoText: {
    fontVariant: ['tabular-nums'],
  },
  orderPane: {
    flex: 1,
    minWidth: 340,
    maxWidth: 440,
    flexShrink: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  orderHeader: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  orderTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  orderSubtitle: {
    marginTop: 2,
    fontSize: 11,
  },
  orderCount: {
    minHeight: 22,
    borderRadius: 20,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderCountText: {
    fontSize: 12,
    fontWeight: '700',
  },
  selectedItemsTitle: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  customerRow: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  customerAvatar: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerAvatarText: {
    fontSize: 11,
    fontWeight: '800',
  },
  customerTextWrap: {
    flex: 1,
  },
  customerName: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  customerSub: {
    marginTop: 2,
    fontSize: 11,
  },
  orderStatsRow: {
    paddingHorizontal: 18,
    paddingTop: 10,
    gap: 6,
    flexDirection: 'row',
  },
  orderStatPill: {
    flex: 1,
    minWidth: 0,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  orderStatLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  orderStatValue: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: '700',
  },
  orderScroll: {
    flex: 1,
    minHeight: 0,
  },
  orderScrollContent: {
    paddingBottom: 8,
  },
  emptyOrderState: {
    flex: 1,
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 8,
  },
  emptyOrderGlyph: {
    fontSize: 28,
    fontWeight: '700',
  },
  emptyOrderText: {
    fontSize: 12,
    textAlign: 'center',
  },
  orderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  orderItemIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  orderItemIconText: {
    fontSize: 16,
  },
  orderItemInfo: {
    flex: 1,
    minWidth: 0,
  },
  orderItemName: {
    fontSize: 14,
    fontWeight: '700',
  },
  orderItemSub: {
    marginTop: 1,
    fontSize: 12,
  },
  orderQty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  qtyButton: {
    width: 24,
    height: 24,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  qtyButtonText: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  qtyValue: {
    minWidth: 28,
    height: 24,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    padding: 0,
  },
  orderItemTotal: {
    width: 70,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '700',
  },
  removeItemButton: {
    marginLeft: 4,
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 26,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeItemButtonText: {
    fontSize: 11,
    fontWeight: '800',
  },
  totalsBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 12,
  },
  cashTenderBlock: {
    gap: 8,
  },
  cashTenderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cashTenderTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  cashTenderBadge: {
    minHeight: 22,
    borderRadius: 999,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashTenderBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cashTenderInput: {
    minHeight: 38,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontSize: 13,
    fontWeight: '600',
  },
  billGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  billButton: {
    minWidth: 64,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  billButtonValue: {
    fontSize: 11,
    fontWeight: '700',
  },
  cashTenderActions: {
    flexDirection: 'row',
    gap: 6,
  },
  cashActionButton: {
    flex: 1,
    minHeight: 30,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashActionText: {
    fontSize: 11,
    fontWeight: '700',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalLabel: {
    fontSize: 12,
  },
  totalValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  totalDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
  grandTotalLabel: {
    fontSize: 14,
    fontWeight: '800',
  },
  grandTotalValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  paymentBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 12,
    gap: 8,
  },
  chargeBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 8,
  },
  paymentMethods: {
    flexDirection: 'row',
    gap: 6,
  },
  paymentMethod: {
    flex: 1,
    minHeight: 34,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  paymentMethodGlyph: {
    fontSize: 13,
    fontWeight: '800',
  },
  paymentMethodText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  chargeButton: {
    minHeight: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  chargeButtonGlyph: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  chargeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  feedbackText: {
    fontSize: 11,
    lineHeight: 15,
  },
});