import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listLocalCategories, listLocalProducts, type LocalCategory, type LocalProduct } from '../../services/offlineDb';
import { resolveProductImageUrl } from '../../services/adminService';
import { createSaleLocalFirst, getPosSnapshot, type PosSnapshot } from '../../services/posService';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';

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
const TAX_RATE = 0.08;

const phpFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const money = (cents: number): string => phpFormatter.format(cents / 100);

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
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [categoryTabs, setCategoryTabs] = useState<CategoryTab[]>([{ key: 'all', label: 'All' }]);
  const [activeCategory, setActiveCategory] = useState<DisplayCategory>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'qr'>('cash');
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [feedbackMessage, setFeedbackMessage] = useState<string>('Loading local POS data...');
  const [chargeOverride, setChargeOverride] = useState<string | null>(null);
  const [clockLabel, setClockLabel] = useState<string>('');
  const [cashTenderInput, setCashTenderInput] = useState<string>('');
  const [productImageUrlById, setProductImageUrlById] = useState<Record<string, string | null>>({});
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
    const tabs: CategoryTab[] = [
      { key: 'all', label: 'All' },
      ...categories.filter((category) => category.active).map((category) => ({ key: category.id, label: category.name })),
    ];

    const hasUnassigned = products.some((product) => !product.category_id || !categories.some((category) => category.id === product.category_id));
    if (hasUnassigned) {
      tabs.push({ key: 'unassigned', label: 'Unassigned' });
    }

    setCategoryTabs(tabs);
    setSnapshot(nextSnapshot);
    setFeedbackMessage(feedbackMessage ?? (products.length > 0 ? 'Local data is ready.' : 'No local products found in database.'));
  }, [tenantId]);

  useEffect(() => {
    void loadPosData();
  }, [loadPosData]);

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

  const visibleProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return catalog.filter((product) => {
      const categoryMatch = activeCategory === 'all' || product.categoryKey === activeCategory;
      const searchMatch =
        !query ||
        product.name.toLowerCase().includes(query) ||
        product.categoryLabel.toLowerCase().includes(query);

      return categoryMatch && searchMatch;
    });
  }, [activeCategory, catalog, searchQuery]);

  useEffect(() => {
    if (!categoryTabs.some((tab) => tab.key === activeCategory)) {
      setActiveCategory('all');
    }
  }, [activeCategory, categoryTabs]);

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

  const cashTenderCents = useMemo(() => {
    const normalized = cashTenderInput.trim();

    if (!normalized) {
      return 0;
    }

    const parsedPesos = Number(normalized.replace(/[^0-9]/g, ''));

    if (!Number.isFinite(parsedPesos) || parsedPesos < 0) {
      return 0;
    }

    return Math.round(parsedPesos * 100);
  }, [cashTenderInput]);

  const changeDueCents = useMemo(() => Math.max(0, cashTenderCents - totals.grandTotalCents), [cashTenderCents, totals.grandTotalCents]);

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

  const handleAddCashBill = useCallback((billCents: number) => {
    setCashTenderInput((current) => {
      const parsedPesos = Number(current.trim().replace(/[^0-9]/g, '')) || 0;
      return String(parsedPesos + billCents);
    });
  }, []);

  const handleSetExactCash = useCallback(() => {
    setCashTenderInput(String(Math.ceil(totals.grandTotalCents / 100)));
  }, [totals.grandTotalCents]);

  const handleClearCash = useCallback(() => {
    setCashTenderInput('');
  }, []);

  const handleCashTenderInputChange = useCallback((value: string) => {
    const normalized = value.replace(/[^0-9]/g, '');
    setCashTenderInput(normalized);
  }, []);

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

    if (paymentMethod === 'cash' && cashTenderCents < totals.grandTotalCents) {
      setFeedbackMessage('Cash received is less than the total due.');
      return;
    }

    try {
      await createSaleLocalFirst({
        tenant_id: tenantId,
        cashier_profile_id: profile?.id ?? null,
        total_cents: totals.grandTotalCents,
        expenses_cents: 0,
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
      setFeedbackMessage(
        paymentMethod === 'cash' && changeDueCents > 0
          ? `Sale saved locally and queued for sync. Change due: ${money(changeDueCents)}`
          : 'Sale saved locally and queued for sync.'
      );
      setCashTenderInput('');

      if (chargeResetRef.current) {
        clearTimeout(chargeResetRef.current);
      }

      chargeResetRef.current = setTimeout(() => {
        setChargeOverride(null);
      }, 2000);

      await loadPosData('Sale saved locally and queued for sync.');
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : 'Failed to save local sale');
    }
  }, [cashTenderCents, cartLines, changeDueCents, loadPosData, paymentMethod, profile?.id, tenantId, totals.grandTotalCents]);

  const chargeLabel = chargeOverride ?? `Charge ${money(totals.grandTotalCents)}`;
  const catalogCount = snapshot?.productsCount ?? catalog.length;
  const pendingCount = snapshot?.pendingMutations ?? 0;
  const salesCount = snapshot?.salesCount ?? 0;

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

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabStrip}>
              {categoryTabs.map((tab) => {
                const active = activeCategory === tab.key;

                return (
                  <Pressable
                    key={tab.key}
                    style={[
                      styles.categoryTab,
                      {
                        backgroundColor: active ? palette.surface : 'transparent',
                        borderColor: active ? `${palette.text}22` : 'transparent',
                      },
                    ]}
                    onPress={() => setActiveCategory(tab.key)}
                  >
                    <Text style={[styles.categoryTabText, { color: active ? palette.text : palette.mutedText }]}>{tab.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <ScrollView style={styles.catalogScroll} contentContainerStyle={styles.catalogContent} showsVerticalScrollIndicator={false}>
            {visibleProducts.length === 0 ? (
              <View style={styles.emptyCatalogState}>
                <Text style={[styles.emptyCatalogGlyph, { color: palette.mutedText }]}>◫</Text>
                <Text style={[styles.emptyCatalogTitle, { color: palette.text }]}>No products found</Text>
                <Text style={[styles.emptyCatalogBody, { color: palette.mutedText }]}>No product rows are available in the local database yet.</Text>
              </View>
            ) : (
              visibleProducts.map((product) => {
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
                        borderColor: inCart ? palette.primary : `${palette.text}10`,
                      },
                    ]}
                    onPress={() => handleAddProduct(product)}
                  >
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
                    <Text style={[styles.productStock, { color: product.stockCount < 20 ? palette.accent : palette.mutedText }]}>{stockText}</Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View style={[styles.statusBar, { borderTopColor: `${palette.text}12` }]}>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: palette.success }]} />
              <Text style={[styles.statusText, { color: palette.mutedText }]}>Terminal online</Text>
            </View>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: palette.success }]} />
              <Text style={[styles.statusText, { color: palette.mutedText }]}>Printer ready</Text>
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

          <View style={styles.orderItemsArea}>
            {cartLines.length === 0 ? (
              <View style={styles.emptyOrderState}>
                <Text style={[styles.emptyOrderGlyph, { color: palette.mutedText }]}>◔</Text>
                <Text style={[styles.emptyOrderText, { color: palette.mutedText }]}>Tap a product to add it to this order</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.orderItemsContent}>
                {cartLines.map((line) => (
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
                      <Text style={[styles.qtyValue, { color: palette.text }]}>{line.quantity}</Text>
                      <Pressable style={[styles.qtyButton, { backgroundColor: `${palette.text}08`, borderColor: `${palette.text}10` }]} onPress={() => handleUpdateQuantity(line.key, 1)}>
                        <Text style={[styles.qtyButtonText, { color: palette.text }]}>+</Text>
                      </Pressable>
                    </View>
                    <Text style={[styles.orderItemTotal, { color: palette.text }]}>{money(line.priceCents * line.quantity)}</Text>
                    <Pressable style={[styles.removeItemButton, { borderColor: `${palette.danger}55` }]} onPress={() => handleRemoveFromCart(line.key)}>
                      <Text style={[styles.removeItemButtonText, { color: palette.danger }]}>Remove</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>

          <View style={[styles.totalsBlock, { borderTopColor: `${palette.text}12` }]}>
          
            {paymentMethod === 'cash' ? (
              <>
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: palette.mutedText }]}>Cash Received</Text>
                  <Text style={[styles.totalValue, { color: palette.text }, styles.monoText]}>{money(cashTenderCents)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: palette.mutedText }]}>Change</Text>
                  <Text style={[styles.totalValue, { color: palette.success }, styles.monoText]}>{money(changeDueCents)}</Text>
                </View>
              </>
            ) : null}
          </View>

          <View style={[styles.paymentBlock, { borderTopColor: `${palette.text}12` }]}>
            {paymentMethod === 'cash' ? (
              <View style={styles.cashTenderBlock}>
                <View style={styles.cashTenderHeader}>
                  <Text style={[styles.cashTenderTitle, { color: palette.text }]}>Cash tender</Text>
                  <View style={[styles.cashTenderBadge, { backgroundColor: `${palette.primary}22` }]}>
                    <Text style={[styles.cashTenderBadgeText, { color: palette.primary }]}>{money(cashTenderCents)}</Text>
                  </View>
                </View>

                <TextInput
                  style={[styles.cashTenderInput, { color: palette.text, backgroundColor: palette.background, borderColor: `${palette.text}12` }]}
                  value={cashTenderInput}
                  onChangeText={handleCashTenderInputChange}
                  placeholder="Enter cash paid"
                  placeholderTextColor={palette.mutedText}
                  keyboardType="number-pad"
                  returnKeyType="done"
                />

                <View style={styles.billGrid}>
                  {CASH_BILLS.map((bill) => (
                    <Pressable
                      key={bill}
                      onPress={() => handleAddCashBill(bill)}
                      style={({ pressed }) => [
                        styles.billButton,
                        {
                          borderColor: `${palette.text}12`,
                          backgroundColor: `${palette.surface}CC`,
                          opacity: pressed ? 0.86 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.billButtonValue, { color: palette.text }]}>{money(bill * 100)}</Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.cashTenderActions}>
                  <Pressable style={({ pressed }) => [styles.cashActionButton, { borderColor: `${palette.text}22`, opacity: pressed ? 0.86 : 1 }]} onPress={handleSetExactCash}>
                    <Text style={[styles.cashActionText, { color: palette.text }]}>Exact</Text>
                  </Pressable>
                  <Pressable style={({ pressed }) => [styles.cashActionButton, { borderColor: `${palette.text}22`, opacity: pressed ? 0.86 : 1 }]} onPress={handleClearCash}>
                    <Text style={[styles.cashActionText, { color: palette.text }]}>Clear</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <View style={styles.paymentMethods}>
              {[
                { key: 'cash', label: 'Cash', glyph: '$' },
                { key: 'card', label: 'Card', glyph: '▥' },
                { key: 'qr', label: 'QR', glyph: '▣' },
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

            <Pressable
              style={[
                styles.chargeButton,
                {
                  backgroundColor: totals.grandTotalCents > 0 ? palette.primary : `${palette.primary}66`,
                },
              ]}
              onPress={handleCharge}
              disabled={totals.grandTotalCents <= 0}
            >
              <Text style={styles.chargeButtonGlyph}>→</Text>
              <Text style={styles.chargeButtonText}>{paymentMethod === 'cash' ? `Charge ${money(totals.grandTotalCents)} • Change ${money(changeDueCents)}` : chargeLabel}</Text>
            </Pressable>

            <Text style={[styles.feedbackText, { color: palette.mutedText }]}>{feedbackMessage}</Text>
          </View>
        </View>
      </View>
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
    width: 380,
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
  orderItemsArea: {
    flex: 1,
    minHeight: 0,
    paddingTop: 8,
  },
  orderItemsContent: {
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
    minWidth: 20,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
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