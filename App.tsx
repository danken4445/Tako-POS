import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { AdminDashboardScreen } from './src/screens/admin/AdminDashboardScreen';
import { AuthScreen } from './src/screens/auth/AuthScreen';
import { RotateDeviceScreen } from './src/screens/common/RotateDeviceScreen';
import { PosLandscapeScreen } from './src/screens/pos/PosLandscapeScreen';
import { initializeOfflineDb } from './src/services/offlineDb';
import { useAuthStore } from './src/store/authStore';
import { useThemeStore } from './src/store/themeStore';

const AppShell = () => {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const { initialized, loading, session, profile, initialize, error } = useAuthStore();
  const palette = useThemeStore((state) => state.palette);

  useEffect(() => {
    const bootstrap = async () => {
      await initializeOfflineDb();
      await initialize();
    };

    bootstrap();
  }, [initialize]);

  useEffect(() => {
    const applyRoleOrientation = async () => {
      if (!profile) {
        return;
      }

      if (profile.role === 'Cashier') {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      }
    };

    applyRoleOrientation();
  }, [profile]);

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

  if (isLandscape) {
    return <RotateDeviceScreen target="portrait" />;
  }

  return <AdminDashboardScreen />;
};

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        <AppShell />
      </SafeAreaView>
    </SafeAreaProvider>
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
});
