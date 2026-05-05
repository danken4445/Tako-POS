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

let authStateChangeSubscription: { unsubscribe: () => void } | null = null;

const loadContext = async (session: Session | null) => {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }

  if (!session?.user) {
    return { profile: null, preferences: null };
  }

  return fetchUserContext(session.user.id);
};

export const useAuthStore = create<AuthState>((set, get) => ({
  initialized: false,
  loading: false,
  error: null,
  session: null,
  profile: null,
  preferences: null,

  initialize: async () => {
    if (!supabase) {
      set({ initialized: true, loading: false, error: 'Supabase env vars are missing.' });
      return;
    }

    if (get().initialized) {
      return;
    }

    set({ loading: true, error: null });

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        const errorMsg = error.message.toLowerCase();
        // If refresh token is corrupted/missing, clear stored session and allow user to sign in again
        if (errorMsg.includes('refresh token') || errorMsg.includes('invalid token')) {
          await supabase.auth.signOut().catch(() => {
            // ignore errors on signout
          });
          set({ loading: false, initialized: true, error: null, session: null, profile: null, preferences: null });
          return;
        }
        set({ loading: false, initialized: true, error: error.message });
        return;
      }

      try {
        const context = await loadContext(data.session);
        if (!context.preferences) {
          useThemeStore.getState().reset();
        } else {
          useThemeStore.getState().hydrateFromTenant(context.preferences);
        }
        set({
          session: data.session,
          profile: context.profile,
          preferences: context.preferences,
          initialized: true,
          loading: false,
        });
      } catch (contextError) {
        useThemeStore.getState().reset();
        set({
          loading: false,
          initialized: true,
          session: data.session,
          profile: null,
          preferences: null,
          error: contextError instanceof Error ? contextError.message : 'Failed to load user context',
        });
      }
    } catch (initError) {
      set({
        loading: false,
        initialized: true,
        session: null,
        profile: null,
        preferences: null,
        error: initError instanceof Error ? initError.message : 'Failed to initialize auth state',
      });
      return;
    }

    if (!authStateChangeSubscription) {
      const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
        set({ session, loading: true, error: null });
        try {
          const context = await loadContext(session);
          if (!context.preferences) {
            useThemeStore.getState().reset();
          } else {
            useThemeStore.getState().hydrateFromTenant(context.preferences);
          }
          set({
            profile: context.profile,
            preferences: context.preferences,
            loading: false,
          });
        } catch (listenerError) {
          useThemeStore.getState().reset();
          set({
            profile: null,
            preferences: null,
            loading: false,
            error: listenerError instanceof Error ? listenerError.message : 'Unable to refresh session state',
          });
        }
      });

      authStateChangeSubscription = data.subscription;
    }
  },

  signInWithPassword: async (email, password) => {
    if (!supabase) {
      throw new Error('Supabase is not configured.');
    }

    set({ loading: true, error: null });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ loading: false, error: error.message });
      throw error;
    }
  },

  signOut: async () => {
    if (!supabase) {
      useThemeStore.getState().reset();
      set({ session: null, profile: null, preferences: null, loading: false, error: null });
      return;
    }

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