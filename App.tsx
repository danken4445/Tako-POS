import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AdminDashboardScreen } from './src/screens/admin/AdminDashboardScreen';
import { AuthScreen } from './src/screens/auth/AuthScreen';
import { RotateDeviceScreen } from './src/screens/common/RotateDeviceScreen';
import { PosLandscapeScreen } from './src/screens/pos/PosLandscapeScreen';
import { initializeOfflineDb } from './src/services/offlineDb';
import { startSyncEngine, stopSyncEngine } from './src/services/syncService';
import { hasSupabaseEnv } from './src/lib/env';
import { useAuthStore } from './src/store/authStore';
import { useThemeStore } from './src/store/themeStore';

const loadingLogo = require('./assets/TakoPOS-icon.png');

type LoadingScreenProps = {
  backgroundColor: string;
  accentColor: string;
  textColor: string;
  mutedTextColor: string;
  title: string;
  message: string;
};

const LoadingScreen = ({
  backgroundColor,
  accentColor,
  textColor,
  mutedTextColor,
  title,
  message,
}: LoadingScreenProps) => {
  return (
    <View style={[styles.loadingContainer, { backgroundColor }]}> 
      <View style={[styles.glow, styles.glowTop, { backgroundColor: accentColor }]} />
      <View style={[styles.glow, styles.glowBottom, { backgroundColor: accentColor }]} />

      <View style={styles.loadingCard}>
        <View style={styles.logoShell}>
          <Image source={loadingLogo} style={styles.logo} resizeMode="contain" />
        </View>

        <Text style={[styles.loadingTitle, { color: textColor }]}>{title}</Text>
        <Text style={[styles.loadingMessage, { color: mutedTextColor }]}>{message}</Text>

        <ActivityIndicator size="small" color={accentColor} />
      </View>
    </View>
  );
};

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
      <LoadingScreen
        backgroundColor={palette.background}
        accentColor={palette.primary}
        textColor={palette.text}
        mutedTextColor={palette.mutedText}
        title="Supabase not configured"
        message="Copy .env.example to .env, set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart Expo with a clean cache."
      />
    );
  }

  if (!initialized || loading) {
    return (
      <LoadingScreen
        backgroundColor={palette.background}
        accentColor={palette.primary}
        textColor={palette.text}
        mutedTextColor={palette.mutedText}
        title="TakoPOS"
        message="Bootstrapping your store and syncing the latest data."
      />
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (!profile) {
    return (
      <LoadingScreen
        backgroundColor={palette.background}
        accentColor={palette.primary}
        textColor={palette.text}
        mutedTextColor={palette.mutedText}
        title="Loading tenant"
        message={error ?? 'Loading tenant context...'}
      />
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
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 280,
    opacity: 0.14,
  },
  glowTop: {
    top: -80,
    right: -90,
  },
  glowBottom: {
    bottom: -100,
    left: -90,
  },
  loadingCard: {
    width: '82%',
    maxWidth: 360,
    paddingVertical: 30,
    paddingHorizontal: 24,
    borderRadius: 28,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: {
      width: 0,
      height: 14,
    },
    elevation: 8,
  },
  logoShell: {
    width: 112,
    height: 112,
    borderRadius: 32,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: 10,
    },
    elevation: 4,
  },
  logo: {
    width: '84%',
    height: '84%',
  },
  loadingTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  loadingMessage: {
    marginTop: 10,
    marginBottom: 18,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
