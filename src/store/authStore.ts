import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { supabase } from '../lib/supabase';
import { fetchUserContext } from '../services/tenantService';
import { useThemeStore } from './themeStore';
import type { TenantPreferences, UserProfile } from '../types/auth';

type AuthState = {
  initialized: boolean;
  loading: boolean;
  error: string | null;
  session: Session | null;
  profile: UserProfile | null;
  preferences: TenantPreferences | null;
  initialize: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshContext: () => Promise<void>;
};

let hasAuthListener = false;

const loadContext = async (session: Session | null) => {
  const themeStore = useThemeStore.getState();
  if (!session?.user) {
    themeStore.reset();
    return { profile: null, preferences: null };
  }

  const context = await fetchUserContext(session.user.id);
  themeStore.hydrateFromTenant(context.preferences);
  return context;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  initialized: false,
  loading: false,
  error: null,
  session: null,
  profile: null,
  preferences: null,

  initialize: async () => {
    if (get().initialized) {
      return;
    }

    set({ loading: true, error: null });

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      set({ loading: false, initialized: true, error: error.message });
      return;
    }

    try {
      const context = await loadContext(data.session);
      set({
        session: data.session,
        profile: context.profile,
        preferences: context.preferences,
        loading: false,
        initialized: true,
      });
    } catch (contextError) {
      set({
        loading: false,
        initialized: true,
        session: data.session,
        profile: null,
        preferences: null,
        error: contextError instanceof Error ? contextError.message : 'Failed to load user context',
      });
    }

    if (!hasAuthListener) {
      supabase.auth.onAuthStateChange(async (_event, session) => {
        set({ session, loading: true, error: null });
        try {
          const context = await loadContext(session);
          set({
            profile: context.profile,
            preferences: context.preferences,
            loading: false,
          });
        } catch (listenerError) {
          set({
            profile: null,
            preferences: null,
            loading: false,
            error: listenerError instanceof Error ? listenerError.message : 'Unable to refresh session state',
          });
        }
      });

      hasAuthListener = true;
    }
  },

  signInWithPassword: async (email, password) => {
    set({ loading: true, error: null });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ loading: false, error: error.message });
      throw error;
    }
    set({ loading: false });
  },

  signOut: async () => {
    set({ loading: true, error: null });
    const { error } = await supabase.auth.signOut();
    if (error) {
      set({ loading: false, error: error.message });
      throw error;
    }

    useThemeStore.getState().reset();
    set({
      session: null,
      profile: null,
      preferences: null,
      loading: false,
      error: null,
    });
  },

  refreshContext: async () => {
    const session = get().session;
    if (!session) {
      return;
    }

    set({ loading: true, error: null });
    try {
      const context = await loadContext(session);
      set({
        profile: context.profile,
        preferences: context.preferences,
        loading: false,
      });
    } catch (refreshError) {
      set({
        loading: false,
        error: refreshError instanceof Error ? refreshError.message : 'Unable to refresh context',
      });
    }
  },
}));