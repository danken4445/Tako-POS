import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

type GlassPanelProps = {
  children: ReactNode;
};

const GlassPanelComponent = ({ children }: GlassPanelProps) => {
  return (
    <View style={styles.wrapper}>
      <View style={styles.overlay}>{children}</View>
    </View>
  );
};

export const GlassPanel = memo(GlassPanelComponent);

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  overlay: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: 16,
  },
});