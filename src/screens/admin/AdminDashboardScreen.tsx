import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { BrandHeader } from '../../components/common/BrandHeader';
import { GlassPanel } from '../../components/glass/GlassPanel';
import {
  deleteCategory,
  deleteProduct,
  deleteStaffMember,
  getAdminSnapshot,
  saveBranding,
  saveCategory,
  saveProduct,
  saveStaffMember,
  type AdminSnapshot,
  type CategoryInput,
  type ProductInput,
  type StaffInput,
} from '../../services/adminService';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import type { TenantPalette } from '../../types/auth';

type AdminTab = 'overview' | 'products' | 'categories' | 'staff' | 'settings';

const defaultProductForm: ProductInput = {
  tenant_id: '',
  category_id: null,
  name: '',
  price_cents: 0,
  selling_price_cents: 0,
  cost_price_cents: 0,
  inventory_tracking: true,
  stock_count: 0,
  linked_inventory_item_id: null,
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

const paletteFields: Array<keyof TenantPalette> = ['primary', 'accent', 'background', 'surface', 'text', 'mutedText', 'danger', 'success'];

const phpFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatCurrency = (cents: number): string => phpFormatter.format(cents / 100);

const Field = ({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (nextValue: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad' | 'phone-pad';
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
      />
    </View>
  );
};

export const AdminDashboardScreen = () => {
  const { profile, signOut } = useAuthStore();
  const { palette, logoUrl, hydrateFromTenant } = useThemeStore();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [productForm, setProductForm] = useState<ProductInput>(defaultProductForm);
  const [categoryForm, setCategoryForm] = useState<CategoryInput>(defaultCategoryForm);
  const [staffForm, setStaffForm] = useState<StaffInput>(defaultStaffForm);
  const [brandLogoUri, setBrandLogoUri] = useState<string | null>(null);
  const [settingsPalette, setSettingsPalette] = useState<TenantPalette>(palette);

  const tenantId = profile?.tenant_id ?? '';

  const loadSnapshot = useCallback(async () => {
    if (!tenantId) {
      return;
    }

    setLoading(true);
    try {
      const nextSnapshot = await getAdminSnapshot(tenantId);
      setSnapshot(nextSnapshot);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    setSettingsPalette(palette);
  }, [palette]);

  useEffect(() => {
    if (!profile?.tenant_id) {
      return;
    }

    setProductForm((current) => ({ ...defaultProductForm, tenant_id: profile.tenant_id, category_id: current.category_id }));
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
      price_cents: product.price_cents,
      selling_price_cents: product.selling_price_cents,
      cost_price_cents: product.cost_price_cents,
      inventory_tracking: product.inventory_tracking,
      stock_count: product.stock_count,
      linked_inventory_item_id: product.linked_inventory_item_id,
      deduction_multiplier: product.deduction_multiplier,
      active: product.active,
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
      await saveProduct({
        ...productForm,
        tenant_id: tenantId,
        price_cents: Math.max(0, Math.round(Number(productForm.selling_price_cents || 0))),
        selling_price_cents: Math.max(0, Math.round(Number(productForm.selling_price_cents || 0))),
        cost_price_cents: Math.max(0, Math.round(Number(productForm.cost_price_cents || 0))),
        stock_count: Math.max(0, Number(productForm.stock_count || 0)),
        linked_inventory_item_id: productForm.linked_inventory_item_id || null,
        deduction_multiplier: Number.isFinite(Number(productForm.deduction_multiplier)) && Number(productForm.deduction_multiplier) > 0 ? Number(productForm.deduction_multiplier) : 1,
        inventory_tracking: Boolean(productForm.inventory_tracking),
        active: Boolean(productForm.active),
      });

      setStatusMessage('Product saved and queued for sync.');
      setProductForm({ ...defaultProductForm, tenant_id: tenantId });
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

    await deleteProduct(tenantId, product);
    setProductForm({ ...defaultProductForm, tenant_id: tenantId });
    setStatusMessage('Product archived.');
    await loadSnapshot();
  };

  const handleSaveCategory = async () => {
    if (!tenantId) {
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

    await deleteCategory(tenantId, category);
    setCategoryForm({ ...defaultCategoryForm, tenant_id: tenantId });
    setStatusMessage('Category archived.');
    await loadSnapshot();
  };

  const handleSaveStaff = async () => {
    if (!tenantId) {
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

    await deleteStaffMember(tenantId, staff);
    setStaffForm({ ...defaultStaffForm, tenant_id: tenantId });
    setStatusMessage('Staff member archived.');
    await loadSnapshot();
  };

  const handlePickLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsMultipleSelection: false,
    });

    if (result.canceled || !result.assets[0]?.uri) {
      return;
    }

    setBrandLogoUri(result.assets[0].uri);
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
        <Text style={[styles.cardBody, { color: palette.mutedText }]}>{statusMessage}</Text>
      </GlassPanel>
    </View>
  );

  const renderProducts = () => (
    <View style={styles.contentStack}>
      <GlassPanel>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>{productForm.id ? 'Edit Product' : 'New Product'}</Text>
        <Text style={[styles.sectionHint, { color: palette.mutedText }]}>Prices are shown in PHP and stored in centavos.</Text>
        <Field label="Name" value={productForm.name} onChangeText={(nextValue) => setProductForm((current) => ({ ...current, name: nextValue }))} placeholder="Chicken bowl" />
        <Field label="Selling Price" value={String(productForm.selling_price_cents)} onChangeText={(nextValue) => setProductForm((current) => ({ ...current, selling_price_cents: Number(nextValue) || 0 }))} placeholder="1250" keyboardType="numeric" />
        <Field label="Cost Price" value={String(productForm.cost_price_cents)} onChangeText={(nextValue) => setProductForm((current) => ({ ...current, cost_price_cents: Number(nextValue) || 0 }))} placeholder="700" keyboardType="numeric" />
        <Field label="Stock Count" value={String(productForm.stock_count)} onChangeText={(nextValue) => setProductForm((current) => ({ ...current, stock_count: Number(nextValue) || 0 }))} placeholder="0" keyboardType="numeric" />
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

        <Text style={[styles.fieldLabel, { color: palette.mutedText }]}>Linked Inventory</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip label="No link" active={!productForm.linked_inventory_item_id} onPress={() => setProductForm((current) => ({ ...current, linked_inventory_item_id: null }))} />
          {snapshot?.inventoryItems.map((item) => (
            <Chip
              key={item.id}
              label={`${item.name}${item.quantity != null ? ` · ${item.quantity}` : ''}`}
              active={productForm.linked_inventory_item_id === item.id}
              onPress={() => setProductForm((current) => ({ ...current, linked_inventory_item_id: item.id }))}
            />
          ))}
        </ScrollView>
        <Text style={[styles.inlineHint, { color: palette.mutedText }]}>If linked, checkout will deduct this inventory item instead of product stock.</Text>

        <View style={styles.switchRow}>
          <Switch value={productForm.inventory_tracking} onValueChange={(value) => setProductForm((current) => ({ ...current, inventory_tracking: value }))} />
          <Text style={[styles.switchLabel, { color: palette.text }]}>Track stock</Text>
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
        </View>
      </GlassPanel>

      <GlassPanel>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Products</Text>
        {snapshot?.products.length ? snapshot.products.map((product) => (
          <Pressable key={product.id} style={styles.listRow} onPress={() => selectProduct(product.id)}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: palette.text }]}>{product.name}</Text>
              <Text style={[styles.rowMeta, { color: palette.mutedText }]}>
                {formatCurrency(product.selling_price_cents)} sell · {formatCurrency(product.cost_price_cents)} cost · stock {product.stock_count}
              </Text>
            </View>
            <Text style={[styles.rowValue, { color: product.active ? palette.success : palette.mutedText }]}>{product.active ? 'On' : 'Off'}</Text>
          </Pressable>
        )) : (
          <View style={styles.emptyStateBlock}>
            <Text style={[styles.emptyStateTitle, { color: palette.text }]}>No products yet</Text>
            <Text style={[styles.cardBody, { color: palette.mutedText }]}>Create your first product to start selling from POS.</Text>
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
        <Field label="Color" value={categoryForm.color ?? ''} onChangeText={(nextValue) => setCategoryForm((current) => ({ ...current, color: nextValue }))} placeholder="#12b886" />
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
          <Field
            key={fieldName}
            label={fieldName}
            value={settingsPalette[fieldName]}
            onChangeText={(nextValue) => setSettingsPalette((current) => ({ ...current, [fieldName]: nextValue }))}
            placeholder="#12b886"
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
    products: renderProducts(),
    categories: renderCategories(),
    staff: renderStaff(),
    settings: renderSettings(),
  }[activeTab];

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <View style={[styles.heroGlow, { backgroundColor: palette.accent }]} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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

        <Pressable style={[styles.logoutButton, { borderColor: `${palette.text}33` }]} onPress={signOut}>
          <Text style={[styles.logoutText, { color: palette.text }]}>Sign out</Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.bottomNav, { backgroundColor: palette.surface, borderTopColor: `${palette.text}22` }]}>
        {([
          ['overview', 'Overview'],
          ['products', 'Products'],
          ['categories', 'Categories'],
          ['staff', 'Staff'],
          ['settings', 'Settings'],
        ] as Array<[AdminTab, string]>).map(([tab, label]) => (
          <Pressable key={tab} onPress={() => setActiveTab(tab)} style={styles.navItem}>
            <Text style={[styles.navText, { color: activeTab === tab ? palette.primary : palette.mutedText }]}>{label}</Text>
            {activeTab === tab ? <View style={[styles.navIndicator, { backgroundColor: palette.primary }]} /> : null}
          </Pressable>
        ))}
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
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 110,
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
  inlineHint: {
    fontSize: 11,
    marginTop: 4,
    marginBottom: 10,
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
  colorSwatch: {
    width: 22,
    height: 22,
    borderRadius: 8,
  },
  emptyStateBlock: {
    paddingVertical: 12,
  },
  emptyStateTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  bottomNav: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 8,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
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
  logoutButton: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  logoutText: {
    fontWeight: '600',
  },
});