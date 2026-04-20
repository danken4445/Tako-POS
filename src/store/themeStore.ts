import { create } from 'zustand';

import type { TenantPalette, TenantPreferences } from '../types/auth';

const defaultPalette: TenantPalette = {
  primary: '#12b886',
  accent: '#ff2a6d',
  background: '#0d1117',
  surface: '#131a22',
  text: '#f2f5f7',
  mutedText: '#9ba8b4',
  danger: '#ff5d5d',
  success: '#1ec98b',
};

type ThemeState = {
  palette: TenantPalette;
  logoUrl: string | null;
  hydrateFromTenant: (preferences: TenantPreferences | null) => void;
  reset: () => void;
};

const sanitizeHex = (value: string): string => {
  const normalized = value.trim();
  return /^#([0-9A-Fa-f]{6})$/.test(normalized) ? normalized : '#12b886';
};

const applyPalette = (incoming: Partial<TenantPalette> | null): TenantPalette => {
  if (!incoming) {
    return defaultPalette;
  }

  return {
    primary: incoming.primary ? sanitizeHex(incoming.primary) : defaultPalette.primary,
    accent: incoming.accent ? sanitizeHex(incoming.accent) : defaultPalette.accent,
    background: incoming.background ? sanitizeHex(incoming.background) : defaultPalette.background,
    surface: incoming.surface ? sanitizeHex(incoming.surface) : defaultPalette.surface,
    text: incoming.text ? sanitizeHex(incoming.text) : defaultPalette.text,
    mutedText: incoming.mutedText ? sanitizeHex(incoming.mutedText) : defaultPalette.mutedText,
    danger: incoming.danger ? sanitizeHex(incoming.danger) : defaultPalette.danger,
    success: incoming.success ? sanitizeHex(incoming.success) : defaultPalette.success,
  };
};

export const useThemeStore = create<ThemeState>((set) => ({
  palette: defaultPalette,
  logoUrl: null,
  hydrateFromTenant: (preferences) => {
    set({
      palette: applyPalette(preferences?.color_palette ?? null),
      logoUrl: preferences?.logo_url ?? null,
    });
  },
  reset: () => set({ palette: defaultPalette, logoUrl: null }),
}));