import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { GlassPanel } from '../../components/glass/GlassPanel';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';

export const AuthScreen = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const passwordRef = useRef<TextInput>(null);

  const { signInWithPassword, loading, error } = useAuthStore();
  const palette = useThemeStore((state) => state.palette);

  const onLogin = useCallback(async () => {
    if (!email || !password || loading) {
      return;
    }

    await signInWithPassword(email.trim(), password);
  }, [email, loading, password, signInWithPassword]);

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <View style={[styles.glow, { backgroundColor: palette.accent }]} />
      <KeyboardAvoidingView
        style={styles.formWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <GlassPanel>
          <Text style={[styles.heading, { color: palette.text }]}>TakoPOS</Text>
          <Text style={[styles.subheading, { color: palette.mutedText }]}>Secure tenant sign-in</Text>

          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="next"
            placeholder="Email"
            placeholderTextColor={palette.mutedText}
            style={[styles.input, { color: palette.text, borderColor: `${palette.text}33` }]}
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <TextInput
            ref={passwordRef}
            secureTextEntry
            returnKeyType="done"
            placeholder="Password"
            placeholderTextColor={palette.mutedText}
            style={[styles.input, { color: palette.text, borderColor: `${palette.text}33` }]}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={onLogin}
          />

          {!!error && <Text style={[styles.error, { color: palette.danger }]}>{error}</Text>}

          <Pressable
            onPress={onLogin}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            accessibilityState={{ disabled: loading }}
            disabled={loading}
            style={[styles.button, { backgroundColor: palette.primary, opacity: loading ? 0.7 : 1 }]}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>
        </GlassPanel>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  glow: {
    position: 'absolute',
    top: 120,
    left: -80,
    width: 240,
    height: 240,
    borderRadius: 999,
    opacity: 0.25,
  },
  formWrap: {
    width: '100%',
  },
  heading: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  subheading: {
    marginTop: 6,
    marginBottom: 18,
    fontSize: 14,
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  error: {
    marginBottom: 10,
    fontSize: 13,
  },
  button: {
    marginTop: 4,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});