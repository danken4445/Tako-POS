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

const buildTenantPreferences = async (row: TenantPreferenceQuery | null, tenantId: string): Promise<TenantPreferences> => {
  const logoUrl = await resolveTenantLogoUrl(row?.logo_path ?? null);

  if (!row) {
    return {
      tenant_id: tenantId,
      color_palette: null,
      logo_path: null,
      logo_url: logoUrl,
    };
  }

  return {
    tenant_id: row.tenant_id,
    color_palette: row.color_palette,
    logo_path: row.logo_path,
    logo_url: logoUrl,
  };
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const resolveTenantLogoUrl = async (logoPath: string | null): Promise<string | null> => {
  if (!supabase) {
    return null;
  }

  if (!logoPath) {
    return null;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await withTimeout(
        supabase.storage.from('tenant-assets').createSignedUrl(logoPath, 60 * 60 * 24),
        5000,
        'Create signed logo URL'
      );

      if (!error && data?.signedUrl) {
        return data.signedUrl;
      }
    } catch (error) {
      if (attempt === 1) {
        console.warn('Unable to sign tenant logo URL', error);
      }
    }
  }

  return null;
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

  return {
    profile,
    preferences: preferencesData ? await buildTenantPreferences(preferencesData, profile.tenant_id) : null,
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

  const { data: currentPreferences, error: currentError } = await supabase
    .from('tenant_preferences')
    .select('tenant_id, color_palette, logo_path')
    .eq('tenant_id', tenantId)
    .maybeSingle<TenantPreferenceQuery>();

  if (currentError) {
    throw new Error(currentError.message);
  }

  let logoPath: string | null = null;
  if (logoImageUri) {
    logoPath = await uploadTenantLogo(tenantId, logoImageUri);
  }

  const nextLogoPath = logoPath ?? currentPreferences?.logo_path ?? null;

  const { error } = await supabase.from('tenant_preferences').upsert(
    {
      tenant_id: tenantId,
      color_palette: colorPalette,
      logo_path: nextLogoPath,
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
    return buildTenantPreferences({ tenant_id: tenantId, color_palette: colorPalette, logo_path: nextLogoPath }, tenantId);
  }

  return buildTenantPreferences(data, tenantId);
};