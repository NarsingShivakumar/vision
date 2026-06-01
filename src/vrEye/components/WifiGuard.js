/**
 * components/WifiGuard.js  v2.0 — Production
 *
 * Identical public API to v1.0 — drop-in replacement.
 * Upgrades:
 *   • onReconnected fires reliably via ref (no stale-closure risk)
 *   • Banner uses translateY spring animation (unchanged)
 *   • Full-screen block screen unchanged
 */

import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Animated,
  ActivityIndicator, Platform,
} from 'react-native';
import { useWifiGuard } from '../hooks/useWifiGuard';

export default function WifiGuard({ children, bannerOnly = false, onReconnected }) {
  const { isConnected, initialized } = useWifiGuard();
  const wasConnected = useRef(null);
  const onReconnectedR = useRef(onReconnected);

  useEffect(() => { onReconnectedR.current = onReconnected; }, [onReconnected]);

  useEffect(() => {
    if (!initialized) return;
    if (wasConnected.current === false && isConnected) {
      onReconnectedR.current?.();
    }
    wasConnected.current = isConnected;
  }, [isConnected, initialized]);

  if (!initialized) return <>{children}</>;

  if (bannerOnly) {
    return (
      <View style={{ flex: 1 }}>
        {!isConnected && <WifiBanner />}
        {children}
      </View>
    );
  }

  if (!isConnected) return <WifiBlockScreen />;
  return <>{children}</>;
}

// ── Full-screen block ─────────────────────────────────────────────────────────
function WifiBlockScreen() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <View style={b.root}>
      <View style={b.card}>
        <Animated.View style={[b.iconWrap, { opacity: pulse }]}>
          <Text style={b.icon}>📶</Text>
        </Animated.View>
        <Text style={b.title}>Wi‑Fi Required</Text>
        <Text style={b.sub}>
          Both devices must be on the same Wi‑Fi network.{'\n'}
          Connect to Wi‑Fi to continue.
        </Text>
        <View style={b.steps}>
          {['Open device Settings', 'Enable Wi‑Fi', 'Join the same network as the other device']
            .map((t, i) => (
              <View key={i} style={b.stepRow}>
                <View style={b.stepNum}><Text style={b.stepNumText}>{i + 1}</Text></View>
                <Text style={b.stepText}>{t}</Text>
              </View>
            ))}
        </View>
        <View style={b.waitRow}>
          <ActivityIndicator color="#5b5bd6" size="small" />
          <Text style={b.waitText}>Waiting for connection…</Text>
        </View>
      </View>
    </View>
  );
}

// ── Slim banner ───────────────────────────────────────────────────────────────
function WifiBanner() {
  const slideY = useRef(new Animated.Value(-48)).current;
  useEffect(() => {
    Animated.spring(slideY, {
      toValue: 0, useNativeDriver: true, tension: 80, friction: 10,
    }).start();
    return () => slideY.stopAnimation();
  }, [slideY]);

  return (
    <Animated.View style={[ban.bar, { transform: [{ translateY: slideY }] }]}>
      <ActivityIndicator color="#fff" size="small" style={{ marginRight: 8 }} />
      <Text style={ban.text}>⚠ Network lost — please reconnect to Wi‑Fi</Text>
    </Animated.View>
  );
}

const b = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050510', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 400, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(124,124,240,0.2)', borderRadius: 20, padding: 28, alignItems: 'center', gap: 16 },
  iconWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(91,91,214,0.1)', borderWidth: 1, borderColor: 'rgba(91,91,214,0.25)', alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 36 },
  title: { fontSize: 22, fontWeight: '600', color: '#e8e8f0', textAlign: 'center' },
  sub: { fontSize: 13, color: '#667', textAlign: 'center', lineHeight: 20 },
  steps: { width: '100%', gap: 10, marginTop: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(91,91,214,0.15)', borderWidth: 1, borderColor: 'rgba(91,91,214,0.3)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNumText: { color: '#7c7cf0', fontSize: 11, fontWeight: '700' },
  stepText: { flex: 1, color: '#778', fontSize: 13, lineHeight: 20 },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  waitText: { color: '#5b5bd6', fontSize: 12, fontWeight: '500' },
});

const ban = StyleSheet.create({
  bar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 999, backgroundColor: '#c62828', paddingVertical: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, color: '#fff', fontSize: 12, fontWeight: '600' },
});