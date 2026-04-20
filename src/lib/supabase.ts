import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

import { hasSupabaseEnv, supabaseAnonKey, supabaseUrl } from './env';

const secureStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      if (Platform.OS === 'web') {
        return globalThis.localStorage?.getItem(key) ?? null;
      }

      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (Platform.OS === 'web') {
        globalThis.localStorage?.setItem(key, value);
        return;
      }

      await SecureStore.setItemAsync(key, value);
    } catch {
      return;
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      if (Platform.OS === 'web') {
        globalThis.localStorage?.removeItem(key);
        return;
      }

      await SecureStore.deleteItemAsync(key);
    } catch {
      return;
    }
  },
};

export const supabase = hasSupabaseEnv
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        storage: secureStorageAdapter,
        autoRefreshToken: false,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;