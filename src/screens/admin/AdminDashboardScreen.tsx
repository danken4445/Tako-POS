import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import ColorPicker from 'react-native-wheel-color-picker';

import { BrandHeader } from '../../components/common/BrandHeader';
import { GlassPanel } from '../../components/glass/GlassPanel';
import {
  clearTenantData,
  deleteCategory,
  deleteInventoryItem,
  deleteProduct,
  deleteStaffMember,
  getAdminSnapshot,
  resolveProductImageUrl,
  saveInventoryItem,
  saveBranding,
  saveCategory,
  saveProduct,
  saveStaffMember,
  type AdminSnapshot,
  type CategoryInput,
  type InventoryInput,
  type ProductInput,
  type StaffInput,
} from '../../services/adminService';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import type { TenantPalette } from '../../types/auth';

type AdminTab = 'overview' | 'transactions' | 'shiftReports' | 'products' | 'inventory' | 'categories' | 'staff' | 'settings';

const defaultProductForm: ProductInput = {
  tenant_id: '',
  category_id: null,
  name: '',
  image_path: null,
  price_cents: 0,
  selling_price_cents: 0,
  cost_price_cents: 0,
  inventory_tracking: true,
  stock_count: 0,
  linked_inventory_item_id: null,
  linked_inventory_item_ids: [],
  deduction_multiplier: 1,
  active: true,
};

const defaultCategoryForm: CategoryInput = {
  tenant_id: '',
  name: '',
  color: '#12b886',
  active: true,
};

const defaultStaffForm: StaffInput = {
  tenant_id: '',
  name: '',
  role: 'Cashier',
  phone: '',
  pin_code: '',
  active: true,
};

const defaultInventoryForm: InventoryInput = {
  tenant_id: '',
  sku: '',
  name: '',
  quantity: 0,
  unit: 'pcs',
};

const ingredientQuickAdds = ['Cups', 'Straws', 'Lids', 'Napkins', 'Paper Bags', 'Spoons', 'Forks', 'Sugar'];

const paletteFields: Array<keyof TenantPalette> = ['primary', 'accent', 'background', 'surface', 'text', 'mutedText', 'danger', 'success'];

const phpFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const VARIANCE_ALERT_CENTS = 500;

const formatCurrency = (cents: number): string => phpFormatter.format(cents / 100);

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

const parseLinkedInventoryIds = (linkedIdsJson: string | null, fallbackLinkedId: string | null): string[] => {
  if (linkedIdsJson) {
    try {
      const parsed = JSON.parse(linkedIdsJson);
      if (Array.isArray(parsed)) {
        return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
      }
    } catch {
      // Ignore malformed linked inventory JSON and fall back to the legacy single linked ID.
    }
  }

  return fallbackLinkedId ? [fallbackLinkedId] : [];
};

const Field = ({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (nextValue: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad' | 'phone-pad';
  editable?: boolean;
}) => {
  const { palette } = useThemeStore();

  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, { color: palette.mutedText }]}>{label}</Text>
      <TextInput
        style={[
          styles.textInput,
          {
            color: palette.text,
            borderColor: `${palette.text}2A`,
            backgroundColor: `${palette.surface}CC`,
          },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.mutedText}
        keyboardType={keyboardType}
        editable={editable}
      />
    </View>
  );
};

const MoneyField = ({
  label,
  valueCents,
  onChangeCents,
  placeholder,
}: {
  label: string;
  valueCents: number;
  onChangeCents: (nextCents: number) => void;
  placeholder?: string;
}) => {
  const { palette } = useThemeStore();
  const [draftValue, setDraftValue] = useState<string>(formatCentsAsPesoInput(valueCents));

  useEffect(() => {
    setDraftValue(formatCentsAsPesoInput(valueCents));
  }, [valueCents]);

  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, { color: palette.mutedText }]}>{label}</Text>
      <TextInput
        style={[
          styles.textInput,
          {
            color: palette.text,
            borderColor: `${palette.text}2A`,
            backgroundColor: `${palette.surface}CC`,
          },
        ]}
        value={draftValue}
        onChangeText={(nextValue) => {
          const normalized = normalizeCurrencyInput(nextValue);
          setDraftValue(normalized);
          onChangeCents(parsePesoInputToCents(normalized));
        }}
        onBlur={() => setDraftValue(formatCentsAsPesoInput(parsePesoInputToCents(draftValue)))}
        placeholder={placeholder}
        placeholderTextColor={palette.mutedText}
        keyboardType="decimal-pad"
      />
      <Text style={[styles.inlineHint, styles.moneyFieldHint, { color: palette.mutedText }]}>Use peso format (e.g. 125.50)</Text>
    </View>
  );
};

const normalizeHexColor = (value: string): string => {
  const sanitized = value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase();
  return `#${sanitized}`;
};

const ColorWheelField = ({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (nextValue: string) => void;
}) => {
  const { palette } = useThemeStore();
  const normalizedValue = /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#12B886';

  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, { color: palette.mutedText }]}>{label}</Text>
      <TextInput
        style={[
          styles.textInput,
          {
            color: palette.text,
            borderColor: `${palette.text}2A`,
            backgroundColor: `${palette.surface}CC`,
          },
        ]}
        value={value}
        onChangeText={(nextValue) => onChangeText(normalizeHexColor(nextValue))}
        placeholder="#12B886"
        placeholderTextColor={palette.mutedText}
        autoCapitalize="characters"
      />
      <View style={styles.colorWheelWrap}>
        <ColorPicker
          color={normalizedValue}
          onColorChangeComplete={(nextColor) => onChangeText(nextColor.toUpperCase())}
          thumbSize={24}
          sliderSize={24}
          noSnap
          row={false}
          swatches={false}
        />
      </View>
    </View>
  );
};

export const AdminDashboardScreen = () => {
  const { profile, signOut } = useAuthStore();
  const { palette, logoUrl, hydrateFromTenant } = useThemeStore();
  const { width, height } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [productForm, setProductForm] = useState<ProductInput>(defaultProductForm);
  const [productImageUri, setProductImageUri] = useState<string | null>(null);
  const [productImagePreviewUrlById, setProductImagePreviewUrlById] = useState<Record<string, string | null>>({});
  const [selectedProductIds, setSelectedProductIds] = useState<Record<string, true>>({});
  const [productBulkMode, setProductBulkMode] = useState(false);
  const [inventoryForm, setInventoryForm] = useState<InventoryInput>(defaultInventoryForm);
  const [selectedInventoryIds, setSelectedInventoryIds] = useState<Record<string, true>>({});
  const [inventoryBulkMode, setInventoryBulkMode] = useState(false);
  const [categoryForm, setCategoryForm] = useState<CategoryInput>(defaultCategoryForm);
  const [staffForm, setStaffForm] = useState<StaffInput>(defaultStaffForm);
  const [brandLogoUri, setBrandLogoUri] = useState<string | null>(null);
  const [settingsPalette, setSettingsPalette] = useState<TenantPalette>(palette);
  const [expandedTransactionIds, setExpandedTransactionIds] = useState<Record<string, true>>({});
  const [refreshingSnapshot, setRefreshingSnapshot] = useState(false);

  const tenantId = profile?.tenant_id ?? '';
  const isLandscape = width > height;

  const loadSnapshot = useCallback(async (options?: { silent?: boolean }) => {
    if (!tenantId) {
      return;
    }

    if (options?.silent) {
      setRefreshingSnapshot(true);
    } else {
      setLoading(true);
    }

    try {
      const nextSnapshot = await getAdminSnapshot(tenantId);
      setSnapshot(nextSnapshot);

      const imagePreviewEntries = await Promise.all(
        nextSnapshot.products.map(async (product) => [product.id, await resolveProductImageUrl(product.image_path)] as const)
      );

      setProductImagePreviewUrlById(Object.fromEntries(imagePreviewEntries));
    } finally {
      if (options?.silent) {
        setRefreshingSnapshot(false);
      } else {
        setLoading(false);
      }
    }
  }, [tenantId]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (!tenantId) {
      return;
    }

    const intervalId = setInterval(() => {
      void loadSnapshot({ silent: true });
    }, 5000);

    return () => clearInterval(intervalId);
  }, [loadSnapshot, tenantId]);

  useEffect(() => {
    setSettingsPalette(palette);
  }, [palette]);

  useEffect(() => {
    if (!profile?.tenant_id) {
      return;
    }

    setProductForm((current) => ({ ...defaultProductForm, tenant_id: profile.tenant_id, category_id: current.category_id }));
    setProductImageUri(null);
    setInventoryForm({ ...defaultInventoryForm, tenant_id: profile.tenant_id });
    setCategoryForm({ ...defaultCategoryForm, tenant_id: profile.tenant_id });
    setStaffForm({ ...defaultStaffForm, tenant_id: profile.tenant_id });
  }, [profile?.tenant_id]);

  const topMetrics = useMemo(() => snapshot?.overview ?? null, [snapshot]);
  const counts = useMemo(
    () => ({
      products: snapshot?.products.length ?? 0,
      categories: snapshot?.categories.length ?? 0,
      staff: snapshot?.staffMembers.length ?? 0,
      inventory: snapshot?.inventoryItems.length ?? 0,
    }),
    [snapshot]
  );

  const statusIsError = useMemo(() => {
    const normalized = statusMessage.toLowerCase();
    return normalized.includes('failed') || normalized.includes('error') || normalized.includes('unable');
  }, [statusMessage]);

  const isOwner = profile?.role === 'StoreOwner' || profile?.role === 'SuperAdmin';

  const toggleTransactionExpanded = (transactionId: string) => {
    setExpandedTransactionIds((current) => {
      const next = { ...current };
      if (next[transactionId]) {
        delete next[transactionId];
      } else {
        next[transactionId] = true;
      }
      return next;
    });
  };

  const clearAllData = async () => {
    if (!tenantId) {
      return;
    }

    Alert.alert(
      'Clear all data?',
      'This will permanently delete sales, line items, products, inventory, categories, staff, and sync history for this tenant. Branding stays intact.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Final warning', 'This cannot be undone. Delete everything now?', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete all data',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await clearTenantData(tenantId);
                    setExpandedTransactionIds({});
                    setSelectedProductIds({});
                    setProductBulkMode(false);
                    setSelectedInventoryIds({});
                    setInventoryBulkMode(false);
                    setProductForm({ ...defaultProductForm, tenant_id: tenantId });
                    setInventoryForm({ ...defaultInventoryForm, tenant_id: tenantId });
                    setCategoryForm({ ...defaultCategoryForm, tenant_id: tenantId });
                    setStaffForm({ ...defaultStaffForm, tenant_id: tenantId });
                    setProductImageUri(null);
                    setBrandLogoUri(null);
                    setStatusMessage('Tenant data cleared. Refreshing dashboard...');
                    await loadSnapshot();
                  } catch (error) {
                    const message = error instanceof Error ? error.message : 'Unable to clear tenant data.';
                    setStatusMessage(message);
                    Alert.alert('Clear data failed', message);
                  }
                },
              },
            ]);
          },
        },
      ]
    );
  };

  const selectProduct = (productId: string) => {
    const product = snapshot?.products.find((entry) => entry.id === productId);
    if (!product) {
      return;
    }

    setProductForm({
      id: product.id,
      tenant_id: product.tenant_id,
      category_id: product.category_id,
      name: product.name,
      image_path: product.image_path,
      price_cents: product.price_cents,
      selling_price_cents: product.selling_price_cents,
      cost_price_cents: product.cost_price_cents,
      inventory_tracking: product.inventory_tracking,
      stock_count: product.stock_count,
      linked_inventory_item_id: product.linked_inventory_item_id,
      linked_inventory_item_ids: parseLinkedInventoryIds(product.linked_inventory_item_ids_json, product.linked_inventory_item_id),
      deduction_multiplier: product.deduction_multiplier,
      active: product.active,
    });

    setProductImageUri(null);
  };

  const toggleSelectProductId = (productId: string) => {
    setSelectedProductIds((current) => {
      const next = { ...current };
      if (next[productId]) {
        delete next[productId];
      } else {
        next[productId] = true;
      }
      return next;
    });
  };

  const confirmDeleteSelectedProducts = async () => {
    if (!tenantId || !snapshot) return;
    const ids = Object.keys(selectedProductIds);
    if (ids.length === 0) return;

    Alert.alert('Delete selected products', `Archive ${ids.length} selected product(s)?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          for (const id of ids) {
            const product = snapshot.products.find((p) => p.id === id);
            if (product) {
              // eslint-disable-next-line no-await-in-loop
              await deleteProduct(tenantId, product);
            }
          }

          setSelectedProductIds({});
          setProductBulkMode(false);
          setStatusMessage('Selected products archived.');
          await loadSnapshot();
        },
      },
    ]);
  };

  const clearProductEdit = () => {
    setProductForm({ ...defaultProductForm, tenant_id: tenantId });
    setProductImageUri(null);
  };

  const toggleLinkedInventoryItem = (inventoryId: string) => {
    setProductForm((current) => {
      const currentIds = current.linked_inventory_item_ids ?? [];
      const exists = currentIds.includes(inventoryId);
      const nextIds = exists ? currentIds.filter((id) => id !== inventoryId) : [...currentIds, inventoryId];

      return {
        ...current,
        linked_inventory_item_ids: nextIds,
        linked_inventory_item_id: nextIds[0] ?? null,
      };
    });
  };

  const selectCategory = (categoryId: string) => {
    const category = snapshot?.categories.find((entry) => entry.id === categoryId);
    if (!category) {
      return;
    }

    setCategoryForm({
      id: category.id,
      tenant_id: category.tenant_id,
      name: category.name,
      color: category.color ?? '#12b886',
      active: category.active,
    });
  };

  const selectStaff = (staffId: string) => {
    const staff = snapshot?.staffMembers.find((entry) => entry.id === staffId);
    if (!staff) {
      return;
    }

    setStaffForm({
      id: staff.id,
      tenant_id: staff.tenant_id,
      name: staff.name,
      role: staff.role,
      phone: staff.phone,
      pin_code: staff.pin_code,
      active: staff.active,
    });
  };

  const selectInventoryItem = (inventoryId: string) => {
    const item = snapshot?.inventoryItems.find((entry) => entry.id === inventoryId);
    if (!item) {
      return;
    }

    setInventoryForm({
      id: item.id,
      tenant_id: item.tenant_id,
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
    });
  };

  const handleSaveProduct = async () => {
    if (!tenantId) {
      return;
    }

    if (!productForm.name.trim()) {
      const message = 'Product name is required.';
      setStatusMessage(message);
      Alert.alert('Validation error', message);
      return;
    }

    if (productForm.linked_inventory_item_id && Number(productForm.deduction_multiplier) <= 0) {
      const message = 'Linked deduction multiplier must be greater than 0.';
      setStatusMessage(message);
      Alert.alert('Validation error', message);
      return;
    }

    try {
      const saveResult = await saveProduct({
        ...productForm,
        tenant_id: tenantId,
        image_path: productForm.image_path ?? null,
        product_image_uri: productImageUri,
        price_cents: Math.max(0, Math.round(Number(productForm.selling_price_cents || 0))),
        selling_price_cents: Math.max(0, Math.round(Number(productForm.selling_price_cents || 0))),
        cost_price_cents: Math.max(0, Math.round(Number(productForm.cost_price_cents || 0))),
        stock_count: Math.max(0, Number(productForm.stock_count || 0)),
        linked_inventory_item_ids: Array.from(new Set((productForm.linked_inventory_item_ids ?? []).filter(Boolean))),
        linked_inventory_item_id: (productForm.linked_inventory_item_ids ?? [])[0] ?? null,
        deduction_multiplier: Number.isFinite(Number(productForm.deduction_multiplier)) && Number(productForm.deduction_multiplier) > 0 ? Number(productForm.deduction_multiplier) : 1,
        inventory_tracking: Boolean(productForm.inventory_tracking),
        active: Boolean(productForm.active),
      });

      setStatusMessage(
        saveResult.imageUploadError
          ? 'Product saved and queued for sync. Image was not uploaded; re-save the image when online.'
          : 'Product saved and queued for sync.'
      );
      clearProductEdit();
      await loadSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save product.';
      setStatusMessage(message);
      Alert.alert('Product save failed', message);
    }
  };

  const handleDeleteProduct = async () => {
    if (!tenantId || !productForm.id || !snapshot) {
      return;
    }

    const product = snapshot.products.find((entry) => entry.id === productForm.id);
    if (!product) {
      return;
    }

    Alert.alert('Delete product', 'Are you sure you want to archive this product?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          await deleteProduct(tenantId, product);
          clearProductEdit();
          setStatusMessage('Product archived.');
          await loadSnapshot();
        },
      },
    ]);
  };

  const handleSaveInventory = async () => {
    if (!tenantId) {
      return;
    }

    if (!inventoryForm.name.trim()) {
      const message = 'Ingredient name is required.';
      setStatusMessage(message);
      Alert.alert('Validation error', message);
      return;
    }

    try {
      await saveInventoryItem({
        ...inventoryForm,
        tenant_id: tenantId,
        sku: inventoryForm.sku?.trim() || null,
        name: inventoryForm.name.trim(),
        quantity: Math.max(0, Number(inventoryForm.quantity || 0)),
        unit: inventoryForm.unit?.trim() || 'pcs',
      });
      setStatusMessage('Ingredient item saved and queued for sync.');
      setInventoryForm({ ...defaultInventoryForm, tenant_id: tenantId });
      await loadSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save ingredient item.';
      setStatusMessage(message);
      Alert.alert('Save failed', message);
    }
  };

  const toggleSelectInventoryId = (inventoryId: string) => {
    setSelectedInventoryIds((current) => {
      const next = { ...current };
      if (next[inventoryId]) {
        delete next[inventoryId];
      } else {
        next[inventoryId] = true;
      }
      return next;
    });
  };

  const confirmDeleteSelectedInventory = async () => {
    if (!tenantId || !snapshot) return;
    const ids = Object.keys(selectedInventoryIds);
    if (ids.length === 0) return;

    Alert.alert('Delete selected ingredients', `Archive ${ids.length} selected ingredient(s)?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          for (const id of ids) {
            const item = snapshot.inventoryItems.find((i) => i.id === id);
            if (item) {
              // eslint-disable-next-line no-await-in-loop
              await deleteInventoryItem(tenantId, item);
            }
          }

          setSelectedInventoryIds({});
          setInventoryBulkMode(false);
          setStatusMessage('Selected ingredients archived.');
          await loadSnapshot();
        },
      },
    ]);
  };

  const handleDeleteInventory = async () => {
    if (!tenantId || !inventoryForm.id || !snapshot) {
      return;
    }

    const item = snapshot.inventoryItems.find((entry) => entry.id === inventoryForm.id);
    if (!item) {
      return;
    }

    Alert.alert('Delete ingredient', `Archive ingredient "${item.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          await deleteInventoryItem(tenantId, item);
          setInventoryForm({ ...defaultInventoryForm, tenant_id: tenantId });
          setStatusMessage('Ingredient archived.');
          await loadSnapshot();
        },
      },
    ]);
  };

  const handleQuickAddIngredient = async (name: string) => {
    if (!tenantId) {
      return;
    }

    try {
      await saveInventoryItem({
        tenant_id: tenantId,
        name,
        sku: null,
        quantity: 0,
        unit: 'pcs',
      });
      setStatusMessage(`${name} added to ingredients inventory.`);
      await loadSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to add ingredient item.';
      setStatusMessage(message);
      Alert.alert('Quick add failed', message);
    }
  };

  const handleSaveCategory = async () => {
    if (!tenantId) {
      return;
    }

    if (!categoryForm.name || !categoryForm.name.trim()) {
      const message = 'Category name is required.';
      setStatusMessage(message);
      Alert.alert('Validation error', message);
      return;
    }

    await saveCategory({
      ...categoryForm,
      tenant_id: tenantId,
      color: categoryForm.color?.trim() || '#12b886',
      active: Boolean(categoryForm.active),
    });

    setStatusMessage('Category saved.');
    setCategoryForm({ ...defaultCategoryForm, tenant_id: tenantId });
    await loadSnapshot();
  };

  const handleDeleteCategory = async () => {
    if (!tenantId || !categoryForm.id || !snapshot) {
      return;
    }

    const category = snapshot.categories.find((entry) => entry.id === categoryForm.id);
    if (!category) {
      return;
    }

    Alert.alert('Delete category', `Archive category "${category.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          await deleteCategory(tenantId, category);
          setCategoryForm({ ...defaultCategoryForm, tenant_id: tenantId });
          setStatusMessage('Category archived.');
          await loadSnapshot();
        },
      },
    ]);
  };

  const handleSaveStaff = async () => {
    if (!tenantId) {
      return;
    }

    if (!staffForm.name || !staffForm.name.trim()) {
      const message = 'Staff name is required.';
      setStatusMessage(message);
      Alert.alert('Validation error', message);
      return;
    }

    await saveStaffMember({
      ...staffForm,
      tenant_id: tenantId,
      name: staffForm.name.trim(),
      role: staffForm.role.trim() || 'Cashier',
      phone: staffForm.phone?.trim() || null,
      pin_code: staffForm.pin_code?.trim() || null,
      active: Boolean(staffForm.active),
    });

    setStatusMessage('Staff record saved.');
    setStaffForm({ ...defaultStaffForm, tenant_id: tenantId });
    await loadSnapshot();
  };

  const handleDeleteStaff = async () => {
    if (!tenantId || !staffForm.id || !snapshot) {
      return;
    }

    const staff = snapshot.staffMembers.find((entry) => entry.id === staffForm.id);
    if (!staff) {
      return;
    }

    Alert.alert('Delete staff', `Archive staff member "${staff.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          await deleteStaffMember(tenantId, staff);
          setStaffForm({ ...defaultStaffForm, tenant_id: tenantId });
          setStatusMessage('Staff member archived.');
          await loadSnapshot();
        },
      },
    ]);
  };

  const handlePickLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      allowsMultipleSelection: false,
    });

    if (result.canceled || !result.assets[0]?.uri) {
      return;
    }

    setBrandLogoUri(result.assets[0].uri);
  };

  const handlePickProductImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: false,
    });

    if (result.canceled || !result.assets[0]?.uri) {
      return;
    }

    setProductImageUri(result.assets[0].uri);
  };

  const handleClearProductImage = () => {
    setProductImageUri(null);
    setProductForm((current) => ({ ...current, image_path: null }));
  };

  const handleSaveBranding = async () => {
    if (!tenantId) {
      return;
    }

    const nextPreferences = await saveBranding({
      tenantId,
      colorPalette: settingsPalette,
      logoImageUri: brandLogoUri,
    });

    hydrateFromTenant(nextPreferences);
    setBrandLogoUri(null);
    setStatusMessage('Brand settings updated.');
  };

  const renderAnalytics = () => (
    <View style={styles.contentStack}>
      <GlassPanel>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Today / Week / Month</Text>
        <View style={styles.kpiGrid}>
          <KpiCard label="Today Gross Sales" value={formatCurrency(topMetrics?.day.grossSalesCents ?? 0)} />
          <KpiCard label="Today Net Profit" value={formatCurrency(topMetrics?.day.netProfitCents ?? 0)} />
          <KpiCard label="Today Orders" value={`${topMetrics?.day.totalOrders ?? 0}`} />
          <KpiCard label="Today AOV" value={formatCurrency(topMetrics?.day.averageOrderValueCents ?? 0)} />
          <KpiCard label="Week Gross Sales" value={formatCurrency(topMetrics?.week.grossSalesCents ?? 0)} />
          <KpiCard label="Month Gross Sales" value={formatCurrency(topMetrics?.month.grossSalesCents ?? 0)} />
        </View>
      </GlassPanel>

      <GlassPanel>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Top Sellers</Text>
        {topMetrics?.topSellers.length ? (
          topMetrics.topSellers.map((seller) => (
            <View key={`${seller.productId ?? seller.productName}`} style={styles.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: palette.text }]}>{seller.productName}</Text>
                <Text style={[styles.rowMeta, { color: palette.mutedText }]}>
                  {seller.quantitySold} sold · {formatCurrency(seller.revenueCents)} revenue · {seller.marginPercent}% margin
                </Text>
              </View>
              <Text style={[styles.rowValue, { color: palette.primary }]}>{formatCurrency(seller.grossMarginCents)}</Text>
            </View>
          ))
        ) : (
          <Text style={[styles.cardBody, { color: palette.mutedText }]}>No completed sales yet.</Text>
        )}
      </GlassPanel>

      <GlassPanel>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Live Status</Text>
        <Text style={[styles.cardBody, { color: palette.mutedText }]}>Transactions and inventory are stored locally first, then synced in the background.</Text>
        {refreshingSnapshot ? <Text style={[styles.loadingHint, { color: palette.mutedText }]}>Live sync check running...</Text> : null}
        <Text style={[styles.cardBody, { color: palette.mutedText }]}>{statusMessage}</Text>
      </GlassPanel>
    </View>
  );

  const renderTransactions = () => (
    <View style={styles.contentStack}>
      <GlassPanel>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Transaction History</Text>
        <Text style={[styles.sectionHint, { color: palette.mutedText }]}>Live POS sales with expandable line items and profit details.</Text>
        {snapshot?.transactions.length ? (
          <View style={styles.transactionList}>
            {snapshot.transactions.map((transaction) => {
              const expanded = Boolean(expandedTransactionIds[transaction.id]);

              return (
                <View key={transaction.id} style={[styles.transactionCard, { borderColor: `${palette.text}22`, backgroundColor: `${palette.surface}C8` }]}>
                  <Pressable style={styles.transactionHeader} onPress={() => toggleTransactionExpanded(transaction.id)}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>
                        {transaction.id.slice(0, 8).toUpperCase()}
                      </Text>
                      <Text style={[styles.rowMeta, { color: palette.mutedText }]}>
                        {dateTimeFormatter.format(new Date(transaction.createdAt))} · {transaction.items.length} item{transaction.items.length === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <View style={styles.transactionHeaderRight}>
                      <Text style={[styles.transactionTotal, { color: palette.primary }]}>{formatCurrency(transaction.totalCents)}</Text>
                      <Text style={[styles.transactionStatus, { color: transaction.status === 'completed' ? palette.success : palette.mutedText }]}>{transaction.status}</Text>
                    </View>
                  </Pressable>

                  <View style={styles.transactionFooterRow}>
                    <Text style={[styles.transactionFooterText, { color: palette.mutedText }]}>Net {formatCurrency(transaction.netProfitCents)}</Text>
                    <Pressable onPress={() => toggleTransactionExpanded(transaction.id)} style={[styles.transactionToggle, { borderColor: `${palette.text}33` }]}>
                      <Text style={[styles.transactionToggleText, { color: palette.text }]}>{expanded ? 'Collapse' : 'Expand'}</Text>
                    </Pressable>
                  </View>

                  {expanded ? (
                    <View style={styles.transactionDetails}>
                      <View style={styles.transactionDetailGrid}>
                        <View style={styles.transactionMetric}>
                          <Text style={[styles.transactionMetricLabel, { color: palette.mutedText }]}>Gross profit</Text>
                          <Text style={[styles.transactionMetricValue, { color: palette.text }]}>{formatCurrency(transaction.grossProfitCents)}</Text>
                        </View>
                        <View style={styles.transactionMetric}>
                          <Text style={[styles.transactionMetricLabel, { color: palette.mutedText }]}>Expenses</Text>
                          <Text style={[styles.transactionMetricValue, { color: palette.text }]}>{formatCurrency(transaction.expensesCents)}</Text>
                        </View>
                      </View>

                      <Text style={[styles.transactionSectionLabel, { color: palette.mutedText }]}>Items</Text>
                      {transaction.items.map((item) => (
                        <View key={item.id} style={styles.transactionItemRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.rowTitle, { color: palette.text }]}>{item.productName}</Text>
                            <Text style={[styles.rowMeta, { color: palette.mutedText }]}>
                              Qty {item.quantity} · {formatCurrency(item.unitPriceCents)} each
                            </Text>
                          </View>
                          <Text style={[styles.rowValue, { color: palette.primary }]}>{formatCurrency(item.unitPriceCents * item.quantity)}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={[styles.cardBody, { color: palette.mutedText }]}>No transactions yet.</Text>
        )}
      </GlassPanel>
    </View>
  );

  const renderShiftReports = () => (
    <View style={styles.contentStack}>
      <GlassPanel>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Shift Reports</Text>
        <Text style={[styles.sectionHint, { color: palette.mutedText }]}>Z-readings synced from the POS terminal.</Text>
        {snapshot?.shiftReports.length ? (
          <View style={styles.transactionList}>
            {snapshot.shiftReports.map((report) => {
              const variance = report.varianceCents;
              const varianceLabel = variance === 0 ? 'Balanced' : variance < 0 ? 'Short' : 'Over';
              const varianceColor = variance === 0 ? palette.success : variance < 0 ? palette.danger : palette.accent;
              const showAlert = Math.abs(variance) >= VARIANCE_ALERT_CENTS;

              return (
                <View key={report.id} style={[styles.transactionCard, { borderColor: `${palette.text}22`, backgroundColor: `${palette.surface}C8` }]}
                  >
                  <View style={styles.transactionHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>
                        Shift {report.id.slice(0, 8).toUpperCase()}
                      </Text>
                      <Text style={[styles.rowMeta, { color: palette.mutedText }]}>
                        {dateTimeFormatter.format(new Date(report.createdAt))}
                      </Text>
                    </View>
                    <View style={styles.transactionHeaderRight}>
                      <Text style={[styles.transactionTotal, { color: palette.primary }]}>{formatCurrency(report.actualCashCents)}</Text>
                      <Text style={[styles.transactionStatus, { color: varianceColor }]}>{varianceLabel}</Text>
                    </View>
                  </View>

                  <View style={styles.transactionFooterRow}>
                    <Text style={[styles.transactionFooterText, { color: palette.mutedText }]}>Expected {formatCurrency(report.expectedCashCents)}</Text>
                    <Text style={[styles.transactionFooterText, { color: varianceColor }]}>Variance {formatCurrency(variance)}</Text>
                  </View>

                  <View style={styles.transactionDetails}>
                    <View style={styles.transactionDetailGrid}>
                      <View style={styles.transactionMetric}>
                        <Text style={[styles.transactionMetricLabel, { color: palette.mutedText }]}>Cash sales</Text>
                        <Text style={[styles.transactionMetricValue, { color: palette.text }]}>{formatCurrency(report.totalCashSalesCents)}</Text>
                      </View>
                      <View style={styles.transactionMetric}>
                        <Text style={[styles.transactionMetricLabel, { color: palette.mutedText }]}>Pay-ins</Text>
                        <Text style={[styles.transactionMetricValue, { color: palette.text }]}>{formatCurrency(report.payInsCents)}</Text>
                      </View>
                      <View style={styles.transactionMetric}>
                        <Text style={[styles.transactionMetricLabel, { color: palette.mutedText }]}>Payouts</Text>
                        <Text style={[styles.transactionMetricValue, { color: palette.text }]}>{formatCurrency(report.payoutsCents)}</Text>
                      </View>
                    </View>

                    <Text style={[styles.transactionSectionLabel, { color: palette.mutedText }]}>Non-cash payments</Text>
                    <View style={styles.transactionDetailGrid}>
                      <View style={styles.transactionMetric}>
                        <Text style={[styles.transactionMetricLabel, { color: palette.mutedText }]}>Card</Text>
                        <Text style={[styles.transactionMetricValue, { color: palette.text }]}>{formatCurrency(report.paymentsSummary.card ?? 0)}</Text>
                      </View>
                      <View style={styles.transactionMetric}>
                        <Text style={[styles.transactionMetricLabel, { color: palette.mutedText }]}>QR</Text>
                        <Text style={[styles.transactionMetricValue, { color: palette.text }]}>{formatCurrency(report.paymentsSummary.qr ?? 0)}</Text>
                      </View>
                    </View>
                    {showAlert ? (
                      <Text style={[styles.inlineHint, { color: palette.danger }]}>Variance exceeds alert threshold.</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={[styles.cardBody, { color: palette.mutedText }]}>No shift reports synced yet.</Text>
        )}
      </GlassPanel>
    </View>
  );

  const renderProducts = () => (
    <View style={styles.contentStack}>
      <GlassPanel>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>{productForm.id ? 'Edit Product' : 'New Product'}</Text>
        <Text style={[styles.sectionHint, { color: palette.mutedText }]}>Prices are shown in PHP and stored in centavos.</Text>
        {productForm.id ? <Text style={[styles.inlineHint, { color: palette.mutedText }]}>Editing selected product. You can save changes or clear the editor.</Text> : null}
        <Field label="Name" value={productForm.name} onChangeText={(nextValue) => setProductForm((current) => ({ ...current, name: nextValue }))} placeholder="Chicken bowl" />
        <View style={styles.fieldBlock}>
          <Text style={[styles.fieldLabel, { color: palette.mutedText }]}>Product Image</Text>
          <View style={styles.productImageRow}>
            {productImageUri ? (
              <Image source={{ uri: productImageUri }} style={styles.productImagePreview} />
            ) : productForm.id && productImagePreviewUrlById[productForm.id] ? (
              <Image source={{ uri: productImagePreviewUrlById[productForm.id] ?? undefined }} style={styles.productImagePreview} />
            ) : (
              <View style={[styles.productImagePlaceholder, { borderColor: `${palette.text}2A` }]}>
                <Text style={[styles.productImagePlaceholderText, { color: palette.mutedText }]}>No image</Text>
              </View>
            )}

            <View style={styles.productImageActions}>
              <Pressable style={[styles.ghostButton, { borderColor: `${palette.text}33` }]} onPress={handlePickProductImage}>
                <Text style={[styles.ghostButtonText, { color: palette.text }]}>Choose Image</Text>
              </Pressable>
              <Pressable style={[styles.ghostButton, { borderColor: `${palette.text}33` }]} onPress={handleClearProductImage}>
                <Text style={[styles.ghostButtonText, { color: palette.text }]}>Remove Image</Text>
              </Pressable>
            </View>
          </View>
        </View>
        <MoneyField label="Selling Price" valueCents={productForm.selling_price_cents} onChangeCents={(nextCents) => setProductForm((current) => ({ ...current, selling_price_cents: nextCents }))} placeholder="125.00" />
        <MoneyField label="Cost Price" valueCents={productForm.cost_price_cents} onChangeCents={(nextCents) => setProductForm((current) => ({ ...current, cost_price_cents: nextCents }))} placeholder="70.00" />
        <View style={styles.switchRow}>
          <Switch
            value={!productForm.inventory_tracking}
            onValueChange={(value) => setProductForm((current) => ({
              ...current,
              inventory_tracking: !value,
              stock_count: value ? 0 : current.stock_count,
            }))}
          />
          <Text style={[styles.switchLabel, { color: palette.text }]}>Unlimited stock (cooked or baked items)</Text>
        </View>
        <Field
          label="Stock Count"
          value={String(productForm.stock_count)}
          onChangeText={(nextValue) => setProductForm((current) => ({ ...current, stock_count: Number(nextValue) || 0 }))}
          placeholder={productForm.inventory_tracking ? '0' : 'Unlimited'}
          keyboardType="numeric"
          editable={productForm.inventory_tracking}
        />
        <Field label="Linked Deduction Multiplier" value={String(productForm.deduction_multiplier)} onChangeText={(nextValue) => setProductForm((current) => ({ ...current, deduction_multiplier: Number(nextValue) || 0 }))} placeholder="1" keyboardType="decimal-pad" />

        <Text style={[styles.fieldLabel, { color: palette.mutedText }]}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip label="Unassigned" active={!productForm.category_id} onPress={() => setProductForm((current) => ({ ...current, category_id: null }))} />
          {snapshot?.categories.map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              active={productForm.category_id === category.id}
              onPress={() => setProductForm((current) => ({ ...current, category_id: category.id }))}
            />
          ))}
        </ScrollView>

        <Text style={[styles.fieldLabel, { color: palette.mutedText }]}>Linked Inventory (multi-select)</Text>
        <View style={styles.selectGrid}>
          <Pressable
            onPress={() => setProductForm((current) => ({ ...current, linked_inventory_item_id: null, linked_inventory_item_ids: [] }))}
            style={[
              styles.selectGridItem,
              {
                borderColor: (productForm.linked_inventory_item_ids ?? []).length === 0 ? palette.primary : `${palette.text}22`,
                backgroundColor: (productForm.linked_inventory_item_ids ?? []).length === 0 ? `${palette.primary}22` : `${palette.surface}AA`,
              },
            ]}
          >
            <Text style={[styles.selectGridText, { color: (productForm.linked_inventory_item_ids ?? []).length === 0 ? palette.text : palette.mutedText }]}>No link</Text>
          </Pressable>
          {snapshot?.inventoryItems.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => toggleLinkedInventoryItem(item.id)}
              style={[
                styles.selectGridItem,
                {
                  borderColor: (productForm.linked_inventory_item_ids ?? []).includes(item.id) ? palette.primary : `${palette.text}22`,
                  backgroundColor: (productForm.linked_inventory_item_ids ?? []).includes(item.id) ? `${palette.primary}22` : `${palette.surface}AA`,
                },
              ]}
            >
              <Text style={[styles.selectGridText, { color: (productForm.linked_inventory_item_ids ?? []).includes(item.id) ? palette.text : palette.mutedText }]}>{`${item.name}${item.quantity != null ? ` · ${item.quantity}` : ''}`}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.inlineHint, { color: palette.mutedText }]}>Each selected inventory item will be deducted on checkout using the multiplier value.</Text>

        <View style={styles.switchRow}>
          <Switch value={productForm.inventory_tracking} onValueChange={(value) => setProductForm((current) => ({ ...current, inventory_tracking: value }))} />
          <Text style={[styles.switchLabel, { color: palette.text }]}>Track finite stock</Text>
        </View>
        <View style={styles.switchRow}>
          <Switch value={productForm.active} onValueChange={(value) => setProductForm((current) => ({ ...current, active: value }))} />
          <Text style={[styles.switchLabel, { color: palette.text }]}>Active</Text>
        </View>

        <View style={styles.actionRow}>
          <Pressable style={({ pressed }) => [styles.primaryButton, { backgroundColor: palette.primary, opacity: pressed ? 0.88 : 1 }]} onPress={handleSaveProduct}>
            <Text style={styles.primaryButtonText}>Save</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.ghostButton, { borderColor: `${palette.text}33`, opacity: pressed ? 0.88 : 1 }]} onPress={handleDeleteProduct}>
            <Text style={[styles.ghostButtonText, { color: palette.text }]}>Delete</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.ghostButton, { borderColor: `${palette.text}33`, opacity: pressed ? 0.88 : 1 }]} onPress={clearProductEdit}>
            <Text style={[styles.ghostButtonText, { color: palette.text }]}>Clear</Text>
          </Pressable>
        </View>
      </GlassPanel>

      <GlassPanel>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Products</Text>
          {!productBulkMode ? (
            <Pressable onPress={() => setProductBulkMode(true)} style={[styles.ghostButton, { borderColor: `${palette.text}33` }]}>
              <Text style={[styles.ghostButtonText, { color: palette.text }]}>Bulk select</Text>
            </Pressable>
          ) : (
            <View style={{ flexDirection: 'row' }}>
              <Pressable onPress={confirmDeleteSelectedProducts} style={[styles.ghostButton, { borderColor: `${palette.text}33`, marginRight: 6 }]}>
                <Text style={[styles.ghostButtonText, { color: palette.text }]}>Delete selected ({Object.keys(selectedProductIds).length})</Text>
              </Pressable>
              <Pressable onPress={() => { setProductBulkMode(false); setSelectedProductIds({}); }} style={[styles.ghostButton, { borderColor: `${palette.text}33` }]}>
                <Text style={[styles.ghostButtonText, { color: palette.text }]}>Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>
        {snapshot?.products.length ? (
          <View style={styles.inventoryGrid}>
            {snapshot.products.map((product) => (
              <Pressable
                key={product.id}
                style={[
                  styles.inventoryCard,
                  {
                    borderColor: productForm.id === product.id ? palette.primary : `${palette.text}22`,
                    backgroundColor: `${palette.surface}C8`,
                  },
                ]}
                onPress={() => (productBulkMode ? toggleSelectProductId(product.id) : selectProduct(product.id))}
                onLongPress={() => {
                  setProductBulkMode(true);
                  toggleSelectProductId(product.id);
                }}
              >
                {productBulkMode && (
                  <View style={{ position: 'absolute', top: 8, left: 8, zIndex: 2 }}>
                    <Text style={{ color: selectedProductIds[product.id] ? palette.primary : palette.mutedText }}>{selectedProductIds[product.id] ? '✓' : '○'}</Text>
                  </View>
                )}
                {productImagePreviewUrlById[product.id] ? <Image source={{ uri: productImagePreviewUrlById[product.id] ?? undefined }} style={styles.productCardImage} /> : null}
                <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>{product.name}</Text>
                <Text style={[styles.inventoryMeta, { color: palette.mutedText }]} numberOfLines={2}>
                  {formatCurrency(product.selling_price_cents)} sell · {formatCurrency(product.cost_price_cents)} cost
                </Text>
                <Text style={[styles.inventoryMeta, { color: palette.mutedText }]}>Stock {product.stock_count}</Text>
                <Text style={[styles.rowValue, { color: product.active ? palette.success : palette.mutedText, marginTop: 6 }]}>{product.active ? 'On' : 'Off'} · Tap to edit</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.emptyStateBlock}>
            <Text style={[styles.emptyStateTitle, { color: palette.text }]}>No products yet</Text>
            <Text style={[styles.cardBody, { color: palette.mutedText }]}>Create your first product to start selling from POS.</Text>
          </View>
        )}
      </GlassPanel>
    </View>
  );

  const renderInventory = () => (
    <View style={styles.contentStack}>
      <GlassPanel>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>{inventoryForm.id ? 'Edit Ingredient' : 'Add Ingredient'}</Text>
        <Text style={[styles.sectionHint, { color: palette.mutedText }]}>Track consumables like cups, straws, lids, and napkins.</Text>
        <Field label="Ingredient Name" value={inventoryForm.name} onChangeText={(nextValue) => setInventoryForm((current) => ({ ...current, name: nextValue }))} placeholder="Cups" />
        <Field label="SKU (optional)" value={inventoryForm.sku ?? ''} onChangeText={(nextValue) => setInventoryForm((current) => ({ ...current, sku: nextValue }))} placeholder="SUP-CUP-12OZ" />
        <Field label="Quantity" value={String(inventoryForm.quantity)} onChangeText={(nextValue) => setInventoryForm((current) => ({ ...current, quantity: Number(nextValue) || 0 }))} placeholder="0" keyboardType="decimal-pad" />
        <Field label="Unit" value={inventoryForm.unit ?? ''} onChangeText={(nextValue) => setInventoryForm((current) => ({ ...current, unit: nextValue }))} placeholder="pcs" />

        <Text style={[styles.fieldLabel, { color: palette.mutedText }]}>Quick Add Ingredients</Text>
        <View style={styles.quickAddRow}>
          {ingredientQuickAdds.map((item) => (
            <Pressable
              key={item}
              onPress={() => handleQuickAddIngredient(item)}
              style={({ pressed }) => [styles.quickAddButton, { borderColor: `${palette.text}22`, backgroundColor: `${palette.surface}AA`, opacity: pressed ? 0.86 : 1 }]}
            >
              <Text style={[styles.quickAddText, { color: palette.text }]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.actionRow}>
          <Pressable style={({ pressed }) => [styles.primaryButton, { backgroundColor: palette.primary, opacity: pressed ? 0.88 : 1 }]} onPress={handleSaveInventory}>
            <Text style={styles.primaryButtonText}>Save Ingredient</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.ghostButton, { borderColor: `${palette.text}33`, opacity: pressed ? 0.88 : 1 }]} onPress={handleDeleteInventory}>
            <Text style={[styles.ghostButtonText, { color: palette.text }]}>Delete</Text>
          </Pressable>
        </View>
      </GlassPanel>

      <GlassPanel>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Ingredients Inventory</Text>
          {!inventoryBulkMode ? (
            <Pressable onPress={() => setInventoryBulkMode(true)} style={[styles.ghostButton, { borderColor: `${palette.text}33` }]}>
              <Text style={[styles.ghostButtonText, { color: palette.text }]}>Bulk select</Text>
            </Pressable>
          ) : (
            <View style={{ flexDirection: 'row' }}>
              <Pressable onPress={confirmDeleteSelectedInventory} style={[styles.ghostButton, { borderColor: `${palette.text}33`, marginRight: 6 }]}>
                <Text style={[styles.ghostButtonText, { color: palette.text }]}>Delete selected ({Object.keys(selectedInventoryIds).length})</Text>
              </Pressable>
              <Pressable onPress={() => { setInventoryBulkMode(false); setSelectedInventoryIds({}); }} style={[styles.ghostButton, { borderColor: `${palette.text}33` }]}>
                <Text style={[styles.ghostButtonText, { color: palette.text }]}>Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>
        {snapshot?.inventoryItems.length ? (
          <View style={styles.inventoryGrid}>
            {snapshot.inventoryItems.map((item) => (
              <Pressable
                key={item.id}
                style={[styles.inventoryCard, { borderColor: `${palette.text}22`, backgroundColor: `${palette.surface}C8` }]}
                onPress={() => (inventoryBulkMode ? toggleSelectInventoryId(item.id) : selectInventoryItem(item.id))}
                onLongPress={() => {
                  setInventoryBulkMode(true);
                  toggleSelectInventoryId(item.id);
                }}
              >
                {inventoryBulkMode && (
                  <View style={{ position: 'absolute', top: 8, left: 8, zIndex: 2 }}>
                    <Text style={{ color: selectedInventoryIds[item.id] ? palette.primary : palette.mutedText }}>{selectedInventoryIds[item.id] ? '✓' : '○'}</Text>
                  </View>
                )}
                <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>{item.name}</Text>
                <Text style={[styles.inventoryMeta, { color: palette.mutedText }]}>{item.sku ? `SKU: ${item.sku}` : 'No SKU'}</Text>
                <Text style={[styles.inventoryMeta, { color: palette.mutedText }]}>{`${item.quantity} ${item.unit ?? 'pcs'}`}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.emptyStateBlock}>
            <Text style={[styles.emptyStateTitle, { color: palette.text }]}>No ingredients yet</Text>
            <Text style={[styles.cardBody, { color: palette.mutedText }]}>Start with cups, straws, and other consumables for better stock control.</Text>
          </View>
        )}
      </GlassPanel>
    </View>
  );

  const renderCategories = () => (
    <View style={styles.contentStack}>
      <GlassPanel>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>{categoryForm.id ? 'Edit Category' : 'New Category'}</Text>
        <Field label="Name" value={categoryForm.name} onChangeText={(nextValue) => setCategoryForm((current) => ({ ...current, name: nextValue }))} placeholder="Wraps" />
        <ColorWheelField label="Color" value={categoryForm.color ?? '#12B886'} onChangeText={(nextValue) => setCategoryForm((current) => ({ ...current, color: nextValue }))} />
        <View style={styles.switchRow}>
          <Switch value={categoryForm.active} onValueChange={(value) => setCategoryForm((current) => ({ ...current, active: value }))} />
          <Text style={[styles.switchLabel, { color: palette.text }]}>Active</Text>
        </View>

        <View style={styles.actionRow}>
          <Pressable style={[styles.primaryButton, { backgroundColor: palette.primary }]} onPress={handleSaveCategory}>
            <Text style={styles.primaryButtonText}>Save</Text>
          </Pressable>
          <Pressable style={[styles.ghostButton, { borderColor: `${palette.text}33` }]} onPress={handleDeleteCategory}>
            <Text style={[styles.ghostButtonText, { color: palette.text }]}>Delete</Text>
          </Pressable>
        </View>
      </GlassPanel>

      <GlassPanel>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Categories</Text>
        {snapshot?.categories.length ? snapshot.categories.map((category) => (
          <Pressable key={category.id} style={styles.listRow} onPress={() => selectCategory(category.id)}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: palette.text }]}>{category.name}</Text>
              <Text style={[styles.rowMeta, { color: palette.mutedText }]}>{category.color ?? 'No color'}</Text>
            </View>
            <View style={[styles.colorSwatch, { backgroundColor: category.color ?? palette.primary }]} />
          </Pressable>
        )) : (
          <Text style={[styles.cardBody, { color: palette.mutedText }]}>No categories yet.</Text>
        )}
      </GlassPanel>
    </View>
  );

  const renderStaff = () => (
    <View style={styles.contentStack}>
      <GlassPanel>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>{staffForm.id ? 'Edit Staff' : 'New Staff Member'}</Text>
        <Field label="Name" value={staffForm.name} onChangeText={(nextValue) => setStaffForm((current) => ({ ...current, name: nextValue }))} placeholder="Ava" />
        <Field label="Role" value={staffForm.role} onChangeText={(nextValue) => setStaffForm((current) => ({ ...current, role: nextValue }))} placeholder="Cashier" />
        <Field label="Phone" value={staffForm.phone ?? ''} onChangeText={(nextValue) => setStaffForm((current) => ({ ...current, phone: nextValue }))} placeholder="+1 555 0100" keyboardType="phone-pad" />
        <Field label="PIN" value={staffForm.pin_code ?? ''} onChangeText={(nextValue) => setStaffForm((current) => ({ ...current, pin_code: nextValue }))} placeholder="1234" keyboardType="numeric" />
        <View style={styles.switchRow}>
          <Switch value={staffForm.active} onValueChange={(value) => setStaffForm((current) => ({ ...current, active: value }))} />
          <Text style={[styles.switchLabel, { color: palette.text }]}>Active</Text>
        </View>

        <View style={styles.actionRow}>
          <Pressable style={[styles.primaryButton, { backgroundColor: palette.primary }]} onPress={handleSaveStaff}>
            <Text style={styles.primaryButtonText}>Save</Text>
          </Pressable>
          <Pressable style={[styles.ghostButton, { borderColor: `${palette.text}33` }]} onPress={handleDeleteStaff}>
            <Text style={[styles.ghostButtonText, { color: palette.text }]}>Delete</Text>
          </Pressable>
        </View>
      </GlassPanel>

      <GlassPanel>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Staff</Text>
        {snapshot?.staffMembers.length ? snapshot.staffMembers.map((member) => (
          <Pressable key={member.id} style={styles.listRow} onPress={() => selectStaff(member.id)}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: palette.text }]}>{member.name}</Text>
              <Text style={[styles.rowMeta, { color: palette.mutedText }]}>{member.role} · {member.phone ?? 'No phone'}</Text>
            </View>
            <Text style={[styles.rowValue, { color: member.active ? palette.success : palette.mutedText }]}>{member.active ? 'On' : 'Off'}</Text>
          </Pressable>
        )) : (
          <Text style={[styles.cardBody, { color: palette.mutedText }]}>No staff records yet.</Text>
        )}
      </GlassPanel>
    </View>
  );

  const renderSettings = () => (
    <View style={styles.contentStack}>
      <GlassPanel>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Store Branding</Text>
        <Text style={[styles.cardBody, { color: palette.mutedText }]}>Update the logo and tenant palette used across the app.</Text>

        <View style={styles.logoRow}>
          {brandLogoUri ? (
            <Image source={{ uri: brandLogoUri }} style={styles.logoPreview} />
          ) : logoUrl ? (
            <Image source={{ uri: logoUrl }} style={styles.logoPreview} />
          ) : (
            <View style={[styles.logoPlaceholder, { borderColor: `${palette.text}2A` }]} />
          )}
          <Pressable style={[styles.ghostButton, { borderColor: `${palette.text}33` }]} onPress={handlePickLogo}>
            <Text style={[styles.ghostButtonText, { color: palette.text }]}>Choose Logo</Text>
          </Pressable>
        </View>

        {paletteFields.map((fieldName) => (
          <ColorWheelField
            key={fieldName}
            label={fieldName}
            value={settingsPalette[fieldName]}
            onChangeText={(nextValue) => setSettingsPalette((current) => ({ ...current, [fieldName]: nextValue }))}
          />
        ))}

        <Pressable style={[styles.primaryButton, { backgroundColor: palette.primary, marginTop: 6 }]} onPress={handleSaveBranding}>
          <Text style={styles.primaryButtonText}>Save Branding</Text>
        </Pressable>
      </GlassPanel>
    </View>
  );

  const tabContent = {
    overview: renderAnalytics(),
    transactions: renderTransactions(),
    shiftReports: renderShiftReports(),
    products: renderProducts(),
    inventory: renderInventory(),
    categories: renderCategories(),
    staff: renderStaff(),
    settings: renderSettings(),
  }[activeTab];

  const navTabs: Array<[AdminTab, string]> = [
    ['overview', 'Overview'],
    ['transactions', 'Transactions'],
    ['shiftReports', 'Shift Reports'],
    ['products', 'Products'],
    ['inventory', 'Ingredients'],
    ['categories', 'Categories'],
    ['staff', 'Staff'],
    ['settings', 'Settings'],
  ];

  const navContent = (
    <>
      <View style={[styles.navTabs, isLandscape ? styles.navTabsLandscape : styles.navTabsPortrait]}>
        {navTabs.map(([tab, label]) => (
          <Pressable key={tab} onPress={() => setActiveTab(tab)} style={[styles.navItem, isLandscape ? styles.navItemLandscape : styles.navItemPortrait]}>
            <Text style={[styles.navText, { color: activeTab === tab ? palette.primary : palette.mutedText }]}>{label}</Text>
            {activeTab === tab ? <View style={[styles.navIndicator, { backgroundColor: palette.primary }]} /> : null}
          </Pressable>
        ))}
      </View>

      <View style={styles.navSpacer} />

      <View style={[styles.navFooter, isLandscape ? styles.navFooterLandscape : styles.navFooterPortrait]}>
        {isOwner ? (
          <Pressable onPress={clearAllData} style={[styles.navActionButton, { borderColor: `${palette.danger}55`, backgroundColor: `${palette.danger}18` }]}>
            <Text style={[styles.navActionText, { color: palette.danger }]}>Clear data</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={signOut} style={[styles.navActionButton, { borderColor: `${palette.text}33`, backgroundColor: `${palette.surface}D0` }]}>
          <Text style={[styles.navActionText, { color: palette.text }]}>Logout</Text>
        </Pressable>
      </View>
    </>
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <View style={[styles.heroGlow, { backgroundColor: palette.accent }]} />

      <View style={isLandscape ? styles.landscapeLayout : styles.portraitLayout}>
        <ScrollView style={styles.mainScroll} contentContainerStyle={[styles.scrollContent, isLandscape ? styles.scrollContentLandscape : null]} showsVerticalScrollIndicator={false}>
        <BrandHeader
          title={profile?.tenant_name ?? 'Tenant Admin'}
          subtitle={`Role: ${profile?.role ?? 'Unknown'}`}
          logoUrl={logoUrl}
          textColor={palette.text}
          mutedTextColor={palette.mutedText}
        />

        {loading ? <Text style={[styles.loadingHint, { color: palette.mutedText }]}>Refreshing dashboard data...</Text> : null}

        <View style={styles.summaryRow}>
          <SummaryChip label="Products" value={counts.products} />
          <SummaryChip label="Categories" value={counts.categories} />
          <SummaryChip label="Staff" value={counts.staff} />
          <SummaryChip label="Inventory" value={counts.inventory} />
        </View>

        <View
          style={[
            styles.statusBanner,
            {
              backgroundColor: `${statusIsError ? palette.danger : palette.success}1A`,
              borderColor: `${statusIsError ? palette.danger : palette.success}52`,
            },
          ]}
        >
          <Text style={[styles.statusBannerText, { color: statusIsError ? palette.danger : palette.success }]}>{statusMessage}</Text>
        </View>

        {tabContent}
        </ScrollView>

        <View
          style={[
            isLandscape ? styles.sideNav : styles.bottomNav,
            { backgroundColor: palette.surface, borderTopColor: `${palette.text}22`, borderLeftColor: `${palette.text}22` },
          ]}
        >
          {navContent}
        </View>
      </View>
    </View>
  );
};

const KpiCard = ({ label, value }: { label: string; value: string }) => {
  const { palette } = useThemeStore();

  return (
    <View style={[styles.kpiCard, { backgroundColor: `${palette.surface}D0` }]}>
      <Text style={[styles.kpiLabel, { color: palette.mutedText }]}>{label}</Text>
      <Text style={[styles.kpiValue, { color: palette.text }]}>{value}</Text>
    </View>
  );
};

const SummaryChip = ({ label, value }: { label: string; value: number }) => {
  const { palette } = useThemeStore();

  return (
    <View style={[styles.summaryChip, { borderColor: `${palette.text}22`, backgroundColor: `${palette.surface}D8` }]}>
      <Text style={[styles.summaryChipLabel, { color: palette.mutedText }]}>{label}</Text>
      <Text style={[styles.summaryChipValue, { color: palette.text }]}>{value}</Text>
    </View>
  );
};

const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => {
  const { palette } = useThemeStore();

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: active ? palette.primary : `${palette.text}22`,
          backgroundColor: active ? `${palette.primary}22` : `${palette.surface}AA`,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? palette.text : palette.mutedText }]}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  portraitLayout: {
    flex: 1,
  },
  landscapeLayout: {
    flex: 1,
    flexDirection: 'row',
  },
  mainScroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 110,
  },
  scrollContentLandscape: {
    paddingBottom: 24,
  },
  heroGlow: {
    position: 'absolute',
    right: -70,
    top: -70,
    width: 220,
    height: 220,
    borderRadius: 999,
    opacity: 0.16,
  },
  contentStack: {
    marginTop: 20,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  sectionHint: {
    fontSize: 12,
    marginBottom: 10,
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  loadingHint: {
    marginTop: 6,
    fontSize: 12,
  },
  summaryRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryChip: {
    minWidth: '23%',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  summaryChipLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  summaryChipValue: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  statusBanner: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  statusBannerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  kpiCard: {
    width: '48%',
    borderRadius: 16,
    padding: 12,
  },
  kpiLabel: {
    fontSize: 11,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  rowMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  rowValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  fieldBlock: {
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  chipRow: {
    gap: 8,
    paddingVertical: 4,
  },
  selectGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 2,
  },
  selectGridItem: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectGridText: {
    fontSize: 12,
    fontWeight: '600',
  },
  inlineHint: {
    fontSize: 11,
    marginTop: 4,
    marginBottom: 10,
  },
  moneyFieldHint: {
    marginBottom: 0,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  switchLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  primaryButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  ghostButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  ghostButtonText: {
    fontWeight: '700',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  logoPreview: {
    width: 64,
    height: 64,
    borderRadius: 18,
  },
  logoPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 18,
    borderWidth: 1,
  },
  productImageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  productImagePreview: {
    width: 84,
    height: 84,
    borderRadius: 12,
  },
  productImagePlaceholder: {
    width: 84,
    height: 84,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productImagePlaceholderText: {
    fontSize: 11,
    fontWeight: '600',
  },
  productImageActions: {
    flex: 1,
    gap: 8,
  },
  productCardImage: {
    width: '100%',
    height: 96,
    borderRadius: 10,
    marginBottom: 8,
  },
  colorSwatch: {
    width: 22,
    height: 22,
    borderRadius: 8,
  },
  colorWheelWrap: {
    marginTop: 8,
    height: 290,
    borderRadius: 12,
    overflow: 'visible',
  },
  quickAddRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  quickAddButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  quickAddText: {
    fontSize: 12,
    fontWeight: '600',
  },
  inventoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  inventoryCard: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  inventoryMeta: {
    fontSize: 12,
    marginTop: 4,
  },
  emptyStateBlock: {
    paddingVertical: 12,
  },
  emptyStateTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  transactionList: {
    gap: 10,
  },
  transactionCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  transactionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  transactionHeaderRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  transactionTotal: {
    fontSize: 16,
    fontWeight: '800',
  },
  transactionStatus: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  transactionFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  transactionFooterText: {
    fontSize: 12,
    fontWeight: '600',
  },
  transactionToggle: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  transactionToggleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  transactionDetails: {
    marginTop: 12,
    gap: 10,
  },
  transactionDetailGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  transactionMetric: {
    flex: 1,
    borderRadius: 12,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  transactionMetricLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  transactionMetricValue: {
    marginTop: 3,
    fontSize: 14,
    fontWeight: '700',
  },
  transactionSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  transactionItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  navTabs: {
    gap: 6,
  },
  navTabsLandscape: {
    flex: 1,
  },
  navTabsPortrait: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
  },
  navItemPortrait: {
    width: '33.333%',
    minHeight: 38,
    justifyContent: 'center',
  },
  navSpacer: {
    width: '100%',
    minHeight: 10,
  },
  navFooter: {
    gap: 8,
  },
  navFooterLandscape: {
    marginTop: 'auto',
  },
  navFooterPortrait: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
  },
  navActionButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  navActionText: {
    fontSize: 12,
    fontWeight: '800',
  },
  bottomNav: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: 1,
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 8,
    gap: 8,
  },
  sideNav: {
    width: 124,
    borderLeftWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 12,
    gap: 6,
    justifyContent: 'flex-start',
  },
  navItem: {
    alignItems: 'center',
    gap: 4,
  },
  navItemLandscape: {
    width: '100%',
    minHeight: 38,
    justifyContent: 'center',
  },
  navText: {
    fontSize: 11,
    fontWeight: '700',
  },
  navIndicator: {
    width: 20,
    height: 3,
    borderRadius: 999,
  },
});