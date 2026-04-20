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

export const fetchUserContext = async (
  userId: string
): Promise<{ profile: UserProfile; preferences: TenantPreferences | null }> => {
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