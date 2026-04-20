import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandHeader } from '../../components/common/BrandHeader';
import { GlassPanel } from '../../components/glass/GlassPanel';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';

export const PosLandscapeScreen = () => {
  const { profile, signOut } = useAuthStore();
  const { palette, logoUrl } = useThemeStore();

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <View style={[styles.heroGlow, { backgroundColor: palette.accent }]} />

      <BrandHeader
        title={profile?.tenant_name ?? 'TakoPOS POS'}
        subtitle={`Cashier: ${profile?.display_name ?? 'Staff'}`}
        logoUrl={logoUrl}
        textColor={palette.text}
        mutedTextColor={palette.mutedText}
      />

      <View style={styles.contentRow}>
        <View style={styles.leftCol}>
          <GlassPanel>
            <Text style={[styles.sectionTitle, { color: palette.text }]}>Menu Grid</Text>
            <Text style={[styles.sectionBody, { color: palette.mutedText }]}>Landscape-optimized order entry surface for fast taps.</Text>
          </GlassPanel>
          <GlassPanel>
            <Text style={[styles.sectionTitle, { color: palette.text }]}>Cart</Text>
            <Text style={[styles.sectionBody, { color: palette.mutedText }]}>Offline queue and sync pipeline hooks are prepared.</Text>
          </GlassPanel>
        </View>
        <View style={styles.rightCol}>
          <GlassPanel>
            <Text style={[styles.sectionTitle, { color: palette.text }]}>Quick Actions</Text>
            <Text style={[styles.sectionBody, { color: palette.mutedText }]}>Hold, discount, and payment actions belong here.</Text>
            <View style={[styles.actionPill, { backgroundColor: palette.primary }]}>
              <Text style={styles.actionText}>Take Payment</Text>
            </View>
          </GlassPanel>
          <Pressable style={[styles.logoutButton, { borderColor: `${palette.text}33` }]} onPress={signOut}>
            <Text style={[styles.logoutText, { color: palette.text }]}>Sign out</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  heroGlow: {
    position: 'absolute',
    left: -80,
    top: -70,
    width: 240,
    height: 240,
    borderRadius: 999,
    opacity: 0.2,
  },
  contentRow: {
    flex: 1,
    marginTop: 14,
    flexDirection: 'row',
    gap: 12,
  },
  leftCol: {
    flex: 1.4,
    gap: 12,
  },
  rightCol: {
    flex: 1,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  sectionBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  actionPill: {
    marginTop: 14,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
  },
  actionText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  logoutButton: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
  },
  logoutText: {
    fontWeight: '600',
  },
});