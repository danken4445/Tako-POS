import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

type GlassPanelProps = {
  children: ReactNode;
};

export const GlassPanel = ({ children }: GlassPanelProps) => {
  return (
    <View style={styles.wrapper}>
      <BlurView intensity={30} tint="dark" style={styles.blur}>
        <View style={styles.overlay}>{children}</View>
      </BlurView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  blur: {
    width: '100%',
  },
  overlay: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: 16,
  },
});