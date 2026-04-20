import { supabase } from '../lib/supabase';
import type { TenantPreferences, UserProfile } from '../types/auth';

type UserProfileQuery = {
  id: string;
  user_id: string;
  tenant_id: string;
  role: UserProfile['role'];
  display_name: string | null;
  tenants: {
    name: string;
  } | null;
};

type TenantPreferenceQuery = {
  tenant_id: string;
  color_palette: TenantPreferences['color_palette'];
  logo_path: string | null;
};

const resolveTenantLogoUrl = async (logoPath: string | null): Promise<string | null> => {
  if (!supabase) {
    return null;
  }

  if (!logoPath) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from('tenant-assets')
    .createSignedUrl(logoPath, 60 * 60 * 24);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
};

const uploadTenantLogo = async (tenantId: string, imageUri: string): Promise<string> => {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }

  const response = await fetch(imageUri);
  const blob = await response.blob();
  const logoPath = `${tenantId}/logo-${Date.now()}.png`;

  const { error } = await supabase.storage.from('tenant-assets').upload(logoPath, blob, {
    contentType: 'image/png',
    upsert: true,
  });

  if (error) {
    throw new Error(error.message);
  }

  return logoPath;
};

export const fetchUserContext = async (
  userId: string
): Promise<{ profile: UserProfile; preferences: TenantPreferences | null }> => {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }

  const { data: profileData, error: profileError } = await supabase
    .from('user_profiles')
    .select('id, user_id, tenant_id, role, display_name, tenants(name)')
    .eq('user_id', userId)
    .single<UserProfileQuery>();

  if (profileError || !profileData) {
    throw new Error(profileError?.message ?? 'Unable to load profile');
  }

  const profile: UserProfile = {
    id: profileData.id,
    user_id: profileData.user_id,
    tenant_id: profileData.tenant_id,
    role: profileData.role,
    display_name: profileData.display_name,
    tenant_name: profileData.tenants?.name,
  };

  const { data: preferencesData, error: prefError } = await supabase
    .from('tenant_preferences')
    .select('tenant_id, color_palette, logo_path')
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle<TenantPreferenceQuery>();

  if (prefError) {
    throw new Error(prefError.message);
  }

  if (!preferencesData) {
    return { profile, preferences: null };
  }

  const logoUrl = await resolveTenantLogoUrl(preferencesData.logo_path);
  return {
    profile,
    preferences: {
      tenant_id: preferencesData.tenant_id,
      color_palette: preferencesData.color_palette,
      logo_path: preferencesData.logo_path,
      logo_url: logoUrl,
    },
  };
};

export const updateTenantPreferences = async (
  tenantId: string,
  colorPalette: TenantPreferences['color_palette'],
  logoImageUri?: string | null
): Promise<TenantPreferences> => {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }

  let logoPath: string | null = null;
  if (logoImageUri) {
    logoPath = await uploadTenantLogo(tenantId, logoImageUri);
  }

  const { error } = await supabase.from('tenant_preferences').upsert(
    {
      tenant_id: tenantId,
      color_palette: colorPalette,
      logo_path: logoPath,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' }
  );

  if (error) {
    throw new Error(error.message);
  }

  const { data } = await supabase
    .from('tenant_preferences')
    .select('tenant_id, color_palette, logo_path')
    .eq('tenant_id', tenantId)
    .single<TenantPreferenceQuery>();

  if (!data) {
    return {
      tenant_id: tenantId,
      color_palette: colorPalette,
      logo_path: logoPath,
      logo_url: null,
    };
  }

  const logoUrl = await resolveTenantLogoUrl(data.logo_path);
  return {
    tenant_id: data.tenant_id,
    color_palette: data.color_palette,
    logo_path: data.logo_path,
    logo_url: logoUrl,
  };
};