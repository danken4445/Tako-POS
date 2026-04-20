export type AppRole = 'SuperAdmin' | 'StoreOwner' | 'Cashier';

export type UserProfile = {
  id: string;
  user_id: string;
  tenant_id: string;
  role: AppRole;
  display_name: string | null;
  tenant_name?: string;
};

export type TenantPreferences = {
  tenant_id: string;
  color_palette: Partial<TenantPalette> | null;
  logo_path: string | null;
  logo_url: string | null;
};

export type TenantPalette = {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  danger: string;
  success: string;
};