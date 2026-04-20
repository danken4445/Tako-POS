import { Image, StyleSheet, Text, View } from 'react-native';

type BrandHeaderProps = {
  title: string;
  subtitle: string;
  logoUrl: string | null;
  textColor: string;
  mutedTextColor: string;
};

export const BrandHeader = ({
  title,
  subtitle,
  logoUrl,
  textColor,
  mutedTextColor,
}: BrandHeaderProps) => {
  return (
    <View style={styles.container}>
      <View style={styles.brandRow}>
        <View style={styles.logoWrap}>
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={styles.logo} resizeMode="cover" />
          ) : (
            <Text style={[styles.logoFallback, { color: textColor }]}>🐙</Text>
          )}
        </View>
        <View>
          <Text style={[styles.title, { color: textColor }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: mutedTextColor }]}>{subtitle}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  logoFallback: {
    fontSize: 28,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 13,
  },
});