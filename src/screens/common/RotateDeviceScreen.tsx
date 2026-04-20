import { StyleSheet, Text, View } from 'react-native';

import { GlassPanel } from '../../components/glass/GlassPanel';
import { useThemeStore } from '../../store/themeStore';

type RotateDeviceScreenProps = {
  target: 'portrait' | 'landscape';
};

export const RotateDeviceScreen = ({ target }: RotateDeviceScreenProps) => {
  const palette = useThemeStore((state) => state.palette);

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <GlassPanel>
        <Text style={[styles.title, { color: palette.text }]}>Orientation Required</Text>
        <Text style={[styles.body, { color: palette.mutedText }]}>Please rotate your device to {target} mode to continue.</Text>
      </GlassPanel>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
});