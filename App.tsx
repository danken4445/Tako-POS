import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AdminDashboardScreen } from './src/screens/admin/AdminDashboardScreen';
import { AuthScreen } from './src/screens/auth/AuthScreen';
import { RotateDeviceScreen } from './src/screens/common/RotateDeviceScreen';
import { PosLandscapeScreen } from './src/screens/pos/PosLandscapeScreen';
import { initializeOfflineDb } from './src/services/offlineDb';
import { startSyncEngine, stopSyncEngine } from './src/services/syncService';
import { hasSupabaseEnv } from './src/lib/env';
import { useAuthStore } from './src/store/authStore';
import { useThemeStore } from './src/store/themeStore';

const AppShell = () => {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const { initialized, loading, session, profile, initialize, error } = useAuthStore();
  const palette = useThemeStore((state) => state.palette);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        await initializeOfflineDb();
      } catch (error) {
        // Do not block app bootstrap forever if local DB setup fails.
        console.error('Offline DB initialization failed', error);
      }

      if (hasSupabaseEnv) {
        await initialize();
      }
    };

    void bootstrap();
  }, [initialize]);

  useEffect(() => {
    if (!session || !profile?.tenant_id) {
      stopSyncEngine();
      return;
    }

    void startSyncEngine(profile.tenant_id);
    return () => {
      stopSyncEngine();
    };
  }, [session, profile?.tenant_id]);

  useEffect(() => {
    if (!profile) {
      return;
    }

    const applyRoleOrientation = async () => {
      if (profile.role === 'Cashier') {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT);
      }
    };

    applyRoleOrientation();
  }, [profile]);

  if (!hasSupabaseEnv) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: palette.background, paddingHorizontal: 20 }]}>
        <Text style={[styles.missingTitle, { color: palette.text }]}>Supabase not configured</Text>
        <Text style={[styles.loadingText, { color: palette.mutedText, textAlign: 'center' }]}>
          Copy .env.example to .env and make sure EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are set, then restart Expo with a clean cache.
        </Text>
      </View>
    );
  }

  if (!initialized || loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: palette.background }]}>
        <ActivityIndicator size="large" color={palette.primary} />
        <Text style={[styles.loadingText, { color: palette.mutedText }]}>Bootstrapping TakoPOS</Text>
      </View>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (!profile) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: palette.background }]}>
        <Text style={[styles.loadingText, { color: palette.mutedText }]}>
          {error ?? 'Loading tenant context...'}
        </Text>
      </View>
    );
  }

  if (profile.role === 'Cashier') {
    if (!isLandscape) {
      return <RotateDeviceScreen target="landscape" />;
    }

    return <PosLandscapeScreen />;
  }

  return <AdminDashboardScreen />;
};

export default function App() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <AppShell />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
  },
  missingTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
});
