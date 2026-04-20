import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandHeader } from '../../components/common/BrandHeader';
import { GlassPanel } from '../../components/glass/GlassPanel';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';

export const AdminDashboardScreen = () => {
  const { profile, signOut } = useAuthStore();
  const { palette, logoUrl } = useThemeStore();

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <View style={[styles.heroGlow, { backgroundColor: palette.accent }]} />

      <BrandHeader
        title={profile?.tenant_name ?? 'Tenant Admin'}
        subtitle={`Role: ${profile?.role ?? 'Unknown'}`}
        logoUrl={logoUrl}
        textColor={palette.text}
        mutedTextColor={palette.mutedText}
      />

      <View style={styles.grid}>
        <GlassPanel>
          <Text style={[styles.cardTitle, { color: palette.text }]}>Analytics</Text>
          <Text style={[styles.cardBody, { color: palette.mutedText }]}>Sales metrics and trends are ready for Phase 2 wiring.</Text>
        </GlassPanel>

        <GlassPanel>
          <Text style={[styles.cardTitle, { color: palette.text }]}>Inventory</Text>
          <Text style={[styles.cardBody, { color: palette.mutedText }]}>Tenant-scoped inventory management foundation is active.</Text>
        </GlassPanel>

        <GlassPanel>
          <Text style={[styles.cardTitle, { color: palette.text }]}>Theme Preview</Text>
          <Text style={[styles.cardBody, { color: palette.mutedText }]}>Custom palette and logo are loaded from tenant preferences.</Text>
          <View style={[styles.swatch, { backgroundColor: palette.primary }]} />
        </GlassPanel>
      </View>

      <Pressable style={[styles.logoutButton, { borderColor: `${palette.text}33` }]} onPress={signOut}>
        <Text style={[styles.logoutText, { color: palette.text }]}>Sign out</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  heroGlow: {
    position: 'absolute',
    right: -80,
    top: -80,
    width: 240,
    height: 240,
    borderRadius: 999,
    opacity: 0.2,
  },
  grid: {
    marginTop: 20,
    gap: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  swatch: {
    marginTop: 10,
    width: 44,
    height: 44,
    borderRadius: 14,
  },
  logoutButton: {
    marginTop: 'auto',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  logoutText: {
    fontWeight: '600',
  },
});