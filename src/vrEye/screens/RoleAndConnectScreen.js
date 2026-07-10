/**
 * RoleAndConnectScreen.js v3.2 — WiFi Guard + Redux
 *
 * Changes from v3.1:
 * - FIX: Remove try/catch camera guard and cameraAvailable flag — caused "Camera unavailable"
 * - FIX: Switch from useCameraDevice('back') to useCameraDevices() with Scan.js fallback chain
 *        (back → external → front → first available)
 * - FIX: All camera hooks now called unconditionally (no conditional hook calls)
 * - FIX: "No camera" state now shows spinner instead of error (matches Scan.js loading pattern)
 * - KEEP: bestFormat picker, targetFps, auto-zoom, pulse animation, torch chip, 800ms debounce
 */

import React, {
  useState, useEffect, useRef, useCallback, useMemo, memo,
} from 'react';
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  Dimensions, Platform, ActivityIndicator, Animated, Easing,
  ScrollView, StatusBar, Vibration, Alert,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import localPeerService, { PEER_ROLE } from '../services/localPeerService';
import WifiGuard from '../components/WifiGuard';
import { useWifiGuard } from '../hooks/useWifiGuard';
import { Buffer } from 'buffer';
import { NetworkInfo } from 'react-native-network-info';
import UdpSocket from 'react-native-udp';
import QRCode from 'react-native-qrcode-svg';

import {
  Camera,
  useCameraDevices,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';

// ─── Constants ────────────────────────────────────────────────────────────────
const TCP_PORT = 54321;
const UDP_PORT = 54322;
const BEACON_INTERVAL = 2000;
const DISCOVERY_TTL = 2000;

const { width: W, height: H } = Dimensions.get('window');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const randomCode = () => String(Math.floor(100000 + Math.random() * 900000));
const qrPayload = (ip, port, code) =>
  JSON.stringify({ t: 'vreye', ip, port: String(port), code });

// ═══════════════════════════════════════════════════════════════════════════════
export default function RoleAndConnectScreen({ navigation }) {
  const [step, setStep] = useState('role'); // 'role' | 'host' | 'controller'

  // ── Shared peer status ──────────────────────────────────────────────────────
  const [peerStatus, setPeerStatus] = useState({
    connected: false,
    connecting: false,
    reconnecting: false,
    reconnectAttempt: 0,
    reconnectFailed: false,
    rtt: null,
    error: null,
  });

  const [navigating, setNavigating] = useState(false);
  const navigated = useRef(false);

  // ── HOST state ──────────────────────────────────────────────────────────────
  const [localIp, setLocalIp] = useState('');
  const [pairingCode, setPairingCode] = useState(randomCode);
  const [serverReady, setServerReady] = useState(false);

  // ── CONTROLLER state ────────────────────────────────────────────────────────
  const [ctrlTab, setCtrlTab] = useState('discover');
  const [discovered, setDiscovered] = useState([]);
  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState(String(TCP_PORT));
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');

  const udpRef = useRef(null);
  const beaconRef = useRef(null);
  const peerUnsubs = useRef([]);

  // ── Wi-Fi guard (Redux) ─────────────────────────────────────────────────
  useWifiGuard();

  // ── Peer service listeners ──────────────────────────────────────────────────
  useEffect(() => {
    const U = peerUnsubs.current;

    U.push(localPeerService.on('serverready', () =>
      setPeerStatus((p) => ({ ...p, connecting: false, error: null }))
    ));

    U.push(localPeerService.on('connected', ({ address }) =>
      setPeerStatus((p) => ({
        ...p,
        connected: true,
        connecting: false,
        reconnecting: false,
        reconnectFailed: false,
        error: null,
        peerAddress: address,
      }))
    ));

    U.push(localPeerService.on('disconnected', () =>
      setPeerStatus((p) => ({ ...p, connected: false, rtt: null }))
    ));

    U.push(localPeerService.on('reconnecting', ({ attempt }) =>
      setPeerStatus((p) => ({
        ...p,
        reconnecting: true,
        connecting: true,
        reconnectAttempt: attempt,
        connected: false,
        reconnectFailed: false,
      }))
    ));

    U.push(localPeerService.on('reconnectfailed', ({ attempts }) =>
      setPeerStatus((p) => ({
        ...p,
        reconnecting: false,
        connecting: false,
        reconnectFailed: true,
        error: `Could not reconnect after ${attempts} attempts`,
      }))
    ));

    U.push(localPeerService.on('pingrtt', ({ rtt }) =>
      setPeerStatus((p) => ({ ...p, rtt }))
    ));

    U.push(localPeerService.on('peertimeout', () =>
      setPeerStatus((p) => ({ ...p, connected: false, error: 'Peer timed out', rtt: null }))
    ));

    U.push(localPeerService.on('error', ({ message }) =>
      setPeerStatus((p) => ({ ...p, error: message }))
    ));

    return () => { U.forEach((fn) => fn()); };
  }, []);

  // ── Navigate once connected ─────────────────────────────────────────────────
  useEffect(() => {
    if (peerStatus.connected && !navigated.current) {
      navigated.current = true;
      setNavigating(true);
      Vibration.vibrate(60);
      setTimeout(() => {
        if (step === 'host') {
          navigation.replace('PatientScreen', { deviceRole: PEER_ROLE.HOST });
        } else {
          navigation.replace('ControllerScreen');
        }
      }, 900);
    }
  }, [peerStatus.connected, step]); // eslint-disable-line

  // ── HOST: fetch IP + start server ──────────────────────────────────────────
  const startHost = useCallback(async () => {
    stopUdpBeacon();
    setStep('host');
    setPeerStatus((p) => ({ ...p, connecting: true }));
    try {
      const ip =
        await NetworkInfo?.getIPV4Address?.() ??
        await NetworkInfo?.getIPAddress?.() ??
        '';
      setLocalIp(ip);
      startUdpBeacon(ip, TCP_PORT, pairingCode);
    } catch {
      setLocalIp('');
    }
    localPeerService.startServer(TCP_PORT);
    setServerReady(true);
  }, [pairingCode]); // eslint-disable-line

  // ── HOST: UDP broadcast beacon ──────────────────────────────────────────────
  const startUdpBeacon = useCallback((ip, port, code) => {
    if (!UdpSocket) return;
    try {
      const sock = UdpSocket.createSocket({ type: 'udp4', reusePort: true });
      udpRef.current = sock;
      let sockClosed = false;

      // 1. Bind explicitly to the resolved local IP, not 0.0.0.0
      sock.bind(0, ip, () => {
        try { sock.setBroadcast(true); } catch { }
        const msg = JSON.stringify({
          t: 'vreyehost', ip, port, code, name: `VREye-${code}`,
        });
        const buf = Buffer.from(msg);

        // 2. Calculate a directed subnet broadcast (assumes standard /24 subnet)
        // e.g., 192.168.43.1 -> 192.168.43.255
        const subnetBroadcast = ip.includes('.')
          ? ip.split('.').slice(0, 3).join('.') + '.255'
          : '255.255.255.255';

        const broadcast = () => {
          if (sockClosed) return;
          try {
            // Send to the specific subnet to bypass cellular routing traps
            sock.send(buf, 0, buf.length, UDP_PORT, subnetBroadcast);
            // Send global as a fallback for standard routers
            if (subnetBroadcast !== '255.255.255.255') {
              sock.send(buf, 0, buf.length, UDP_PORT, '255.255.255.255');
            }
          } catch { }
        };
        broadcast();
        beaconRef.current = setInterval(broadcast, BEACON_INTERVAL);
      });
      sock.on('close', () => { sockClosed = true; });
      sock.on('error', (e) => {
        console.warn('[Beacon] Socket error:', e.message);
        sockClosed = true;
      });
    } catch (e) {
      console.warn('[Beacon] UDP unavailable:', e.message);
    }
  }, []);

  // ── CONTROLLER: UDP discovery ───────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'controller' || ctrlTab !== 'discover') return;
    if (!UdpSocket) return;

    let sock;
    let sockClosed = false;
    let mounted = true;
    try {
      sock = UdpSocket.createSocket({ type: 'udp4', reusePort: true });
      sock.bind(UDP_PORT, () => {
        try { sock.setBroadcast(true); } catch { }
      });
      sock.on('close', () => { sockClosed = true; });
      sock.on('error', (e) => {
        console.warn('[Discovery] Socket error:', e.message);
        sockClosed = true;
      });
      sock.on('message', (data) => {
        if (sockClosed || !mounted) return;
        try {
          const msg = JSON.parse(data.toString());
          if (msg.t !== 'vreyehost') return;
          setDiscovered((prev) => {
            const entry = {
              ip: msg.ip, port: msg.port, code: msg.code,
              name: msg.name, ts: Date.now(),
            };
            const exists = prev.find((h) => h.ip === msg.ip && h.port === msg.port);
            if (exists) return prev.map((h) =>
              h.ip === msg.ip ? entry : h
            );
            return [...prev, entry];
          });
        } catch { }
      });
    } catch (e) {
      console.warn('[Discovery] UDP unavailable:', e.message);
    }

    const pruner = setInterval(() => {
      if (mounted) {
        setDiscovered((prev) => prev.filter((h) => Date.now() - h.ts < DISCOVERY_TTL));
      }
    }, 3000);

    return () => {
      mounted = false;
      sockClosed = true;
      try { sock?.close(); } catch { }
      clearInterval(pruner);
    };
  }, [step, ctrlTab]);

  // ── CONTROLLER: connect to host ─────────────────────────────────────────────
  const connectToHost = useCallback((ip, port) => {
    setPeerStatus((p) => ({ ...p, connecting: true, error: null, reconnectFailed: false }));
    localPeerService.connectToHost(ip, parseInt(port, 10) || TCP_PORT);
  }, []);

  const connectManual = useCallback(async () => {
    const ip = manualIp.trim();
    if (!ip) {
      Alert.alert('Enter IP', 'Please enter the host device IP address.');
      return;
    }

    // 1. Validate IP Format
    const ipRegex = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
    if (!ipRegex.test(ip)) {
      setPeerStatus((p) => ({ ...p, error: '⚠ YOU HAVE ENTERED WRONG IP ADDRESS', connecting: false }));
      return;
    }

    // 2. Prevent self-connection (Controller trying to connect to itself)
    try {
      const myIp = await NetworkInfo?.getIPV4Address?.() ?? await NetworkInfo?.getIPAddress?.();
      if (ip === myIp) {
        setPeerStatus((p) => ({
          ...p,
          error: 'This device cannot be used as both the Controller Host. Please use a different device.',
          connecting: false
        }));
        return;
      }
    } catch (e) {
      console.warn('Failed to get local IP', e);
    }

    connectToHost(ip, manualPort);
  }, [manualIp, manualPort, connectToHost]);

  // ── CONTROLLER: manual retry after reconnect failed ─────────────────────────
  const handleManualReconnect = useCallback(() => {
    setPeerStatus((p) => ({
      ...p,
      reconnectFailed: false,
      reconnecting: true,
      connecting: true,
      error: null,
    }));
    localPeerService.manualReconnect();
  }, []);

  // ── CONTROLLER: QR scan result ──────────────────────────────────────────────
  const onQRRead = useCallback((payload) => {
    if (scanning) return;
    try {
      const parsed = JSON.parse(payload);
      if (parsed.t !== 'vreye') throw new Error('Not a VREye QR');
      setScanning(true);
      setScanError('');
      connectToHost(parsed.ip, parsed.port);
    } catch {
      setScanError('Invalid QR code. Please scan the code shown on the VR device.');
    }
  }, [scanning, connectToHost]);

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (beaconRef.current) { clearInterval(beaconRef.current); beaconRef.current = null; }
      try { udpRef.current?.close(); } catch { }
      udpRef.current = null;
    };
  }, []);
  const stopUdpBeacon = useCallback(() => {
    if (beaconRef.current) {
      clearInterval(beaconRef.current);
      beaconRef.current = null;
    }
    try { udpRef.current?.close(); } catch { }
    udpRef.current = null;
  }, []);


  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER — Role selection
  // ═══════════════════════════════════════════════════════════════════════════
  if (step === 'role') {
    return (
      <WifiGuard>
        <SafeAreaProvider>
          <SafeAreaView style={r.root} edges={['top', 'bottom', 'left', 'right']}>
            <StatusBar barStyle="light-content" backgroundColor="#050510" />
            <RoleGrid onSelectHost={startHost} onSelectController={() => setStep('controller')} />
          </SafeAreaView>
        </SafeAreaProvider>
      </WifiGuard>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER — HOST panel
  // ═══════════════════════════════════════════════════════════════════════════
  if (step === 'host') {
    return (
      <WifiGuard bannerOnly>
        <SafeAreaProvider>
          <SafeAreaView style={r.root} edges={['top', 'bottom', 'left', 'right']}>
            <StatusBar barStyle="light-content" />
            <ScrollView
              contentContainerStyle={r.scroll}
              showsVerticalScrollIndicator={false}
            >
              <BackBtn onPress={() => {
                localPeerService.destroy();
                stopUdpBeacon();
                setStep('role');
                setPeerStatus((p) => ({ ...p, connecting: false }));
                setServerReady(false);
              }} />

              <View style={r.headerRow}>
                <View style={[r.rolePill, r.rolePillHost]}>
                  <Text style={r.rolePillText}>VR HOST</Text>
                </View>
                <ConnectionDot status={peerStatus} />
              </View>

              <Text style={r.pageTitle}>Waiting for{'\n'}Controller</Text>
              <Text style={r.pageSub}>Share any of these with the controller operator</Text>

              {/* QR Code */}
              <View style={r.qrCard}>
                {QRCode && localIp ? (
                  <QRCode
                    value={qrPayload(localIp, TCP_PORT, pairingCode)}
                    size={160}
                    color="#e8e8f8"
                    backgroundColor="transparent"
                  />
                ) : (
                  <View style={r.qrPlaceholder}>
                    <Text style={r.qrPlaceholderText}>
                      {QRCode ? 'Loading…' : 'Install react-native-qrcode-svg for QR'}
                    </Text>
                  </View>
                )}
                <Text style={r.qrHint}>Scan with controller device</Text>
              </View>

              {/* Divider */}
              <View style={r.orRow}>
                <View style={r.orLine} />
                <Text style={r.orText}>or share</Text>
                <View style={r.orLine} />
              </View>

              {/* Pairing code */}
              <View style={r.codeCard}>
                <Text style={r.codeLabel}>PAIRING CODE</Text>
                <Text style={r.codeValue}>{pairingCode}</Text>
                {/* <TouchableOpacity
                  style={r.refreshBtn}
                  onPress={() => setPairingCode(randomCode())}
                  activeOpacity={0.7}
                >
                  <Text style={r.refreshText}>New code</Text>
                </TouchableOpacity> */}
              </View>

              {/* IP */}
              <View style={r.ipRow}>
                <Text style={r.ipLabel}>IP ADDRESS</Text>
                <Text style={r.ipValue}>{localIp}</Text>
                <Text style={r.ipPort}>{TCP_PORT}</Text>
              </View>

              {/* Status */}
              <View style={r.statusCard}>
                {peerStatus.connected ? (
                  <View style={r.statusRow}>
                    <View style={[r.dot, r.dotGreen]} />
                    <Text style={r.statusText}>Controller connected!</Text>
                    {peerStatus.rtt != null && (
                      <Text style={r.rttPill}>{peerStatus.rtt}ms</Text>
                    )}
                  </View>
                ) : serverReady ? (
                  <View style={r.statusRow}>
                    <PulsingDot color="#f9a825" />
                    <Text style={r.statusText}>Ready — waiting for controller to connect</Text>
                  </View>
                ) : (
                  <View style={r.statusRow}>
                    <ActivityIndicator size="small" color="#7c7cf0" style={{ marginRight: 8 }} />
                    <Text style={r.statusText}>Starting server…</Text>
                  </View>
                )}
              </View>

              {/* Controller disconnection recovery banner */}
              {serverReady && !peerStatus.connected && !peerStatus.connecting && (
                <View style={r.recoveryBanner}>
                  <PulsingDot color="#f9a825" />
                  <View style={{ flex: 1 }}>
                    <Text style={r.recoveryTitle}>Server still running</Text>
                    <Text style={r.recoverySub}>
                      The controller can reconnect at any time — no action needed on this device.
                    </Text>
                  </View>
                </View>
              )}

            </ScrollView>
            {navigating && <NavigatingOverlay />}
          </SafeAreaView>
        </SafeAreaProvider>
      </WifiGuard>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER — CONTROLLER panel
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <WifiGuard bannerOnly>
      <SafeAreaProvider>
        <SafeAreaView style={r.root} edges={['top', 'bottom', 'left', 'right']}>
          <StatusBar barStyle="light-content" />

          <View style={r.ctrlTop}>
            <BackBtn onPress={() => {
              // Destroy any stuck connection attempt and reset status
              localPeerService.destroy();
              setPeerStatus({ connected: false, connecting: false, reconnecting: false, reconnectAttempt: 0, reconnectFailed: false, rtt: null, error: null });
              setStep('role');
            }} />            <View style={r.headerRow}>
              <View style={[r.rolePill, r.rolePillCtrl]}>
                <Text style={r.rolePillText}>CONTROLLER</Text>
              </View>
              <ConnectionDot status={peerStatus} />
            </View>
            <Text style={r.pageTitle}>Find VR Host</Text>
          </View>

          {/* Tab bar */}
          <View style={r.tabBar}>
            {[
              { key: 'discover', icon: '📡', label: 'Discover' },
              { key: 'qr', icon: '📷', label: 'Scan QR' },
              { key: 'manual', icon: '⌨️', label: 'Manual' },
            ].map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[r.tab, ctrlTab === t.key && r.tabActive]}
                onPress={() => {
                  setCtrlTab(t.key);
                  setScanError('');
                  setScanning(false);
                }}
                activeOpacity={0.7}
              >
                <Text style={r.tabIcon}>{t.icon}</Text>
                <Text style={[r.tabLabel, ctrlTab === t.key && r.tabLabelActive]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Tab content */}
          <ScrollView
            contentContainerStyle={r.ctrlScroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {ctrlTab === 'discover' && (
              <DiscoverTab
                discovered={discovered}
                connecting={peerStatus.connecting}
                onConnect={connectToHost}
                udpAvailable={!!UdpSocket}
              />
            )}
            {ctrlTab === 'qr' && (
              <QRTab
                onRead={onQRRead}
                scanning={scanning}
                scanError={scanError}
                connecting={peerStatus.connecting}
              />
            )}
            {ctrlTab === 'manual' && (
              <ManualTab
                ip={manualIp}
                port={manualPort}
                onIpChange={setManualIp}
                onPortChange={setManualPort}
                onConnect={connectManual}
                connecting={peerStatus.connecting}
              />
            )}

            {/* Status / reconnection bar */}
            {(peerStatus.connecting || peerStatus.error || peerStatus.reconnectFailed) && (
              <View style={[
                r.ctrlStatus,
                peerStatus.error ? r.ctrlStatusErr : r.ctrlStatusInfo,
              ]}>
                {peerStatus.connecting && !peerStatus.error && (
                  <ActivityIndicator size="small" color="#7c7cf0" style={{ marginRight: 8 }} />
                )}

                <Text style={[r.ctrlStatusText, { flex: 1 }]}>
                  {peerStatus.error
                    ? peerStatus.error
                    : peerStatus.reconnecting
                      ? `Reconnecting… attempt ${peerStatus.reconnectAttempt}`
                      : 'Connecting…'}
                </Text>

                {peerStatus.reconnectFailed && (
                  <TouchableOpacity
                    style={r.retryBtn}
                    onPress={handleManualReconnect}
                    activeOpacity={0.8}
                  >
                    <Text style={r.retryBtnText}>↺ Retry</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </ScrollView>

          {navigating && <NavigatingOverlay />}
        </SafeAreaView>
      </SafeAreaProvider>
    </WifiGuard>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-screens
// ═══════════════════════════════════════════════════════════════════════════════

function RoleGrid({ onSelectHost, onSelectController }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideVR = useRef(new Animated.Value(30)).current;
  const slideCTRL = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideVR, { toValue: 0, duration: 440, delay: 80, useNativeDriver: true }),
      Animated.timing(slideCTRL, { toValue: 0, duration: 440, delay: 180, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[r.roleRoot, { opacity: fadeAnim }]}>
      <View style={r.roleHeader}>
        <Text style={r.roleEyebrow}>Vision Screening System</Text>
        <Text style={r.roleTitle}>Select{'\n'}Your Role</Text>
        <Text style={r.roleSub}>Both devices must be on the same Wi‑Fi network</Text>
      </View>

      <View style={r.roleCards}>
        <Animated.View style={{ transform: [{ translateY: slideVR }] }}>
          <TouchableOpacity
            style={[r.roleCard, r.roleCardHost]}
            onPress={onSelectHost}
            activeOpacity={0.88}
          >
            <View style={r.roleCardInner}>
              <Text style={r.roleCardEmoji}>🥽</Text>
              <View style={r.roleCardText}>
                <Text style={r.roleCardTitle}>VR Host</Text>
                <Text style={r.roleCardDesc}>Device inside{'\n'}the headset</Text>
              </View>
              <View style={r.roleCardBadge}>
                <Text style={r.roleCardBadgeText}>PATIENT SIDE</Text>
              </View>
              <Text style={r.roleCardArrow}>›</Text>
            </View>
            <View style={[r.roleCardAccent, r.roleCardAccentHost]} />
          </TouchableOpacity>
        </Animated.View>

        <Animated.View style={{ transform: [{ translateY: slideCTRL }] }}>
          <TouchableOpacity
            style={[r.roleCard, r.roleCardCtrl]}
            onPress={onSelectController}
            activeOpacity={0.88}
          >
            <View style={r.roleCardInner}>
              <Text style={r.roleCardEmoji}>🎮</Text>
              <View style={r.roleCardText}>
                <Text style={r.roleCardTitle}>Controller</Text>
                <Text style={r.roleCardDesc}>Operator handles{'\n'}registration</Text>
              </View>
              <View style={[r.roleCardBadge, r.roleCardBadgeCtrl]}>
                <Text style={r.roleCardBadgeText}>OPERATOR SIDE</Text>
              </View>
              <Text style={r.roleCardArrow}>›</Text>
            </View>
            <View style={[r.roleCardAccent, r.roleCardAccentCtrl]} />
          </TouchableOpacity>
        </Animated.View>
      </View>

      <View style={r.roleFooter}>
        {[
          'Both open this screen and select their role',
          'Controller connects to the host via QR, code, or discovery',
          'Registration and test control from the controller device',
        ].map((text, i) => (
          <View key={i} style={r.roleStep}>
            <Text style={r.roleStepNum}>{i + 1}</Text>
            <Text style={r.roleStepText}>{text}</Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

// ── Discover Tab ───────────────────────────────────────────────────────────────
const DiscoverTab = memo(({ discovered, connecting, onConnect, udpAvailable }) => (
  <View style={r.tabContent}>
    {!udpAvailable && (
      <View style={r.infoBox}>
        <Text style={r.infoText}>
          Install <Text style={r.infoEm}>react-native-udp</Text> to enable auto-discovery.
          Use QR scan or manual entry instead.
        </Text>
      </View>
    )}
    {udpAvailable && (
      <>
        <View style={r.discoverHeader}>
          <PulsingDot color="#7c7cf0" />
          <Text style={r.discoverScanText}>Scanning for VR hosts on this network…</Text>
        </View>
        {discovered.length === 0 ? (
          <View style={r.emptyDiscover}>
            <Text style={r.emptyDiscoverEmoji}>📡</Text>
            <Text style={r.emptyDiscoverTitle}>No hosts found yet</Text>
            <Text style={r.emptyDiscoverSub}>
              Make sure the VR host device is on the same Wi‑Fi and has started.
              Use the QR or Manual tab to connect.
            </Text>
          </View>
        ) : (
          <View style={r.hostList}>
            <Text style={r.hostListLabel}>
              {discovered.length} host{discovered.length !== 1 ? 's' : ''} found
            </Text>
            {discovered.map((h) => (
              <TouchableOpacity
                key={h.ip + h.port}
                style={r.hostCard}
                onPress={() => !connecting && onConnect(h.ip, h.port)}
                activeOpacity={0.75}
                disabled={connecting}
              >
                <View style={r.hostCardLeft}>
                  <View style={[r.dot, r.dotGreen]} />
                  <View>
                    <Text style={r.hostCardName}>{h.name ?? 'VREye'}</Text>
                    <Text style={r.hostCardIp}>{h.ip}:{h.port}</Text>
                  </View>
                </View>
                <View style={r.hostCardCode}>
                  <Text style={r.hostCardCodeLabel}>CODE</Text>
                  <Text style={r.hostCardCodeValue}>{h.code}</Text>
                </View>
                <Text style={r.hostCardArrow}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </>
    )}
  </View>
));

// ── QR Tab ─────────────────────────────────────────────────────────────────────
// Matches Scan.js exactly:
//  - useCameraDevices() (plural) with same fallback chain: external → back → front → first
//  - ActivityIndicator spinner while device resolves (no "unavailable" error screen)
//  - useMemo best-format picker (fps bucket first, then resolution)
//  - targetFps derived from chosen format's frameRateRanges
//  - Auto-zoom sweep (0 → min(maxZoom, 2.5) and back, 140 ms steps)
//  - Pulsing Animated focus box (scale + opacity loop via Easing.inOut)
//  - Torch toggle chip top-right
//  - 800 ms scan debounce via lastScanAt ref
const QRTab = memo(({ onRead, scanning, scanError, connecting }) => {
  const devices = useCameraDevices();
  const { hasPermission, requestPermission } = useCameraPermission();
  const [permRequested, setPermRequested] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [torch, setTorch] = useState('off');
  const lastScanAt = useRef(0);

  // Device fallback chain — identical to Scan.js
  let device = null;
  if (devices?.back) device = devices.back;
  if (!device) {
    device =
      devices?.external ||
      devices?.front ||
      (devices && Object.values(devices)[0]);
  }

  // Request permission on mount
  useEffect(() => {
    if (!hasPermission && !permRequested) {
      setPermRequested(true);
      requestPermission();
    }
  }, [hasPermission, permRequested, requestPermission]);

  // Best format picker (fps bucket → pixels)
  const bestFormat = useMemo(() => {
    if (!device || !Array.isArray(device.formats)) return null;
    const scoreFormat = (fmt) => {
      const pw = fmt?.videoWidth || 0;
      const ph = fmt?.videoHeight || 0;
      const pixels = pw * ph;
      const maxFps = (fmt?.frameRateRanges || []).reduce(
        (m, range) => Math.max(m, range?.maxFrameRate || 0), 0,
      );
      const fpsBucket = maxFps >= 55 ? 3 : maxFps >= 29 ? 2 : maxFps >= 24 ? 1 : 0;
      return fpsBucket * 1e12 + pixels;
    };
    const candidates = device.formats.filter(
      (f) => (f?.videoWidth || 0) >= 720 && (f?.videoHeight || 0) >= 720,
    );
    const list = candidates.length ? candidates : device.formats;
    let best = null; let bestScore = -1;
    for (const f of list) {
      const s = scoreFormat(f);
      if (s > bestScore) { bestScore = s; best = f; }
    }
    return best;
  }, [device]);

  // Target FPS from chosen format
  const targetFps = useMemo(() => {
    const ranges = bestFormat?.frameRateRanges || [];
    const supports30 = ranges.some(
      (range) => (range?.minFrameRate || 0) <= 30 && 30 <= (range?.maxFrameRate || 0),
    );
    if (supports30) return 30;
    let best = 0;
    ranges.forEach((range) => { best = Math.max(best, Math.floor(range?.maxFrameRate || 0)); });
    return Math.max(24, best || 24);
  }, [bestFormat]);

  // Pulsing focus box
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // Auto-zoom sweep
  useEffect(() => {
    if (!device || scanning || connecting) return;
    let mounted = true;
    const max = Math.min(device?.maxZoom ?? 1, 2.5);
    const step = 0.08;
    let dir = 1; let z = 0;
    const id = setInterval(() => {
      if (!mounted) return;
      z += dir * step;
      if (z >= max) { z = max; dir = -1; }
      if (z <= 0) { z = 0; dir = 1; }
      setZoom(z);
    }, 140);
    return () => { mounted = false; clearInterval(id); };
  }, [device, scanning, connecting]);

  // Code scanner with 800 ms debounce
  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      const now = Date.now();
      if (now - lastScanAt.current < 800) return;
      lastScanAt.current = now;
      if (scanning || connecting) return;
      const first = codes[0];
      if (first?.value) onRead(first.value);
    },
  });

  // Permission gate
  if (!hasPermission) {
    return (
      <View style={r.tabContent}>
        <View style={r.infoBox}>
          <Text style={r.infoText}>Camera permission is required to scan QR codes.</Text>
        </View>
        <TouchableOpacity style={r.connectBtn} onPress={requestPermission} activeOpacity={0.85}>
          <Text style={r.connectBtnText}>Grant Camera Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Spinner while device resolves — matches Scan.js loading state
  if (!device) {
    return (
      <View style={r.tabContent}>
        <View style={r.cameraContainer}>
          <View style={r.cameraLoading}>
            <ActivityIndicator size="large" color="#7c7cf0" />
            <Text style={r.cameraLoadingText}>Initializing camera…</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={r.tabContent}>
      <Text style={r.qrScanInstr}>Align the QR inside the box</Text>

      <View style={r.cameraContainer}>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={!scanning && !connecting}
          format={bestFormat || undefined}
          fps={targetFps}
          codeScanner={codeScanner}
          zoom={zoom}
          torch={torch}
          enableZoomGesture={true}
        />

        {/* Pulsing focus box overlay */}
        <View style={r.cameraOverlay} pointerEvents="none">
          <Animated.View
            style={[
              r.scanFrame,
              {
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }],
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }),
              },
            ]}
          >
            <View style={[r.scanCorner, r.scanTL]} />
            <View style={[r.scanCorner, r.scanTR]} />
            <View style={[r.scanCorner, r.scanBL]} />
            <View style={[r.scanCorner, r.scanBR]} />
            <Text style={r.scanFrameHint}>Place QR here</Text>
          </Animated.View>
        </View>

        {/* Torch chip — top-right */}
        <View style={r.torchBtnWrap}>
          <TouchableOpacity
            style={r.torchChip}
            onPress={() => setTorch((t) => (t === 'off' ? 'on' : 'off'))}
            activeOpacity={0.8}
          >
            <Text style={r.torchChipText}>
              {torch === 'off' ? '🔦 Torch On' : '💡 Torch Off'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {scanError ? <Text style={r.scanError}>{scanError}</Text> : null}

      {(scanning || connecting) && (
        <View style={r.scanningRow}>
          <ActivityIndicator color="#7c7cf0" size="small" />
          <Text style={r.scanningText}>Connecting…</Text>
        </View>
      )}
    </View>
  );
});

// ── Manual Tab ─────────────────────────────────────────────────────────────────
const ManualTab = memo(({ ip, port, onIpChange, onPortChange, onConnect, connecting }) => (
  <View style={r.tabContent}>
    <Text style={r.manualInstr}>
      Enter the IP address and port shown on the VR host device
    </Text>
    <View style={r.manualField}>
      <Text style={r.manualLabel}>IP ADDRESS</Text>
      <TextInput
        style={r.manualInput}
        value={ip}
        onChangeText={onIpChange}
        placeholder="192.168.1.42"
        placeholderTextColor="#333"
        keyboardType="numeric"
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="next"
      />
    </View>
    <View style={r.manualField}>
      <Text style={r.manualLabel}>PORT</Text>
      <TextInput
        style={[r.manualInput, { width: 120 }]}
        value={port}
        onChangeText={onPortChange}
        placeholder="54321"
        placeholderTextColor="#333"
        keyboardType="numeric"
        returnKeyType="done"
        onSubmitEditing={onConnect}
      />
    </View>
    <TouchableOpacity
      style={[r.connectBtn, connecting && r.connectBtnOff]}
      onPress={onConnect}
      disabled={connecting}
      activeOpacity={0.85}
    >
      {connecting
        ? <ActivityIndicator color="#fff" />
        : <Text style={r.connectBtnText}>Connect</Text>}
    </TouchableOpacity>
  </View>
));

// ── Micro-components ───────────────────────────────────────────────────────────
function BackBtn({ onPress }) {
  return (
    <TouchableOpacity
      style={r.backBtn}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={r.backBtnText}>‹ Back</Text>
    </TouchableOpacity>
  );
}

function ConnectionDot({ status }) {
  const color = status.connected ? '#4caf50' : status.connecting ? '#f9a825' : '#444';
  return (
    <View style={r.connDot}>
      <View style={[r.dot, { backgroundColor: color }]} />
      <Text style={[r.connDotText, { color }]}>
        {status.connected
          ? `Connected${status.rtt != null ? ` · ${status.rtt}ms` : ''}`
          : status.reconnecting
            ? `Reconnecting ${status.reconnectAttempt}`
            : status.connecting
              ? 'Connecting'
              : 'Not connected'}
      </Text>
    </View>
  );
}

function PulsingDot({ color = '#4caf50' }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={[r.dot, { backgroundColor: color, opacity: pulse, marginRight: 8 }]} />
  );
}

function NavigatingOverlay() {
  return (
    <View style={r.navOverlay}>
      <ActivityIndicator color="#5b5bd6" size="large" />
      <Text style={r.navText}>Connected! Entering session…</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════════
const r = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050510' },
  scroll: { paddingBottom: 40, paddingHorizontal: 20 },
  ctrlTop: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 0 },
  ctrlScroll: { padding: 20, paddingTop: 12, paddingBottom: 48 },

  // Role selection
  roleRoot: { flex: 1, paddingHorizontal: 22, paddingTop: Platform.OS === 'ios' ? 8 : 16, paddingBottom: 20 },
  roleHeader: { marginBottom: 28, gap: 6 },
  roleEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 3, color: '#5b5bd6', textTransform: 'uppercase' },
  roleTitle: { fontSize: 40, fontWeight: '200', color: '#eeeeff', letterSpacing: -1, lineHeight: 46 },
  roleSub: { color: '#445', fontSize: 13, marginTop: 4 },
  roleCards: { gap: 12, marginBottom: 28 },
  roleCard: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, minHeight: 120 },
  roleCardHost: { backgroundColor: 'rgba(91,91,214,0.06)', borderColor: 'rgba(91,91,214,0.25)' },
  roleCardCtrl: { backgroundColor: 'rgba(0,188,140,0.06)', borderColor: 'rgba(0,188,140,0.22)' },
  roleCardInner: { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 16, flex: 1 },
  roleCardEmoji: { fontSize: 32 },
  roleCardText: { flex: 1, gap: 3 },
  roleCardTitle: { color: '#dde', fontSize: 18, fontWeight: '600' },
  roleCardDesc: { color: '#667', fontSize: 12, lineHeight: 17 },
  roleCardBadge: { paddingVertical: 3, paddingHorizontal: 8, backgroundColor: 'rgba(91,91,214,0.15)', borderRadius: 4 },
  roleCardBadgeCtrl: { backgroundColor: 'rgba(0,188,140,0.15)' },
  roleCardBadgeText: { color: '#9090d0', fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  roleCardArrow: { color: '#555', fontSize: 18 },
  roleCardAccent: { height: 2, width: '100%' },
  roleCardAccentHost: { backgroundColor: '#5b5bd6' },
  roleCardAccentCtrl: { backgroundColor: '#00bc8c' },
  roleFooter: { gap: 12 },
  roleStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  roleStepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: '#222', textAlign: 'center', lineHeight: 22, color: '#556', fontSize: 11, fontWeight: '700', overflow: 'hidden' },
  roleStepText: { flex: 1, color: '#445', fontSize: 12, lineHeight: 18, paddingTop: 2 },

  // Shared header
  backBtn: { paddingVertical: 6, alignSelf: 'flex-start' },
  backBtnText: { color: '#5b5bd6', fontSize: 13 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  rolePill: { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 100, borderWidth: 1 },
  rolePillHost: { backgroundColor: 'rgba(91,91,214,0.12)', borderColor: 'rgba(91,91,214,0.3)' },
  rolePillCtrl: { backgroundColor: 'rgba(0,188,140,0.1)', borderColor: 'rgba(0,188,140,0.3)' },
  rolePillText: { color: '#c0c0e0', fontSize: 11, fontWeight: '600' },
  pageTitle: { fontSize: 32, fontWeight: '200', color: '#eeeeff', letterSpacing: -0.5, marginTop: 12 },
  pageSub: { color: '#445', fontSize: 13, marginTop: 4, marginBottom: 20 },
  connDot: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  connDotText: { fontSize: 11, fontWeight: '500' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotGreen: { backgroundColor: '#4caf50' },

  // QR
  qrCard: { alignSelf: 'center', alignItems: 'center', padding: 20, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderRadius: 20, gap: 10, marginBottom: 16 },
  qrPlaceholder: { width: 160, height: 160, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 12 },
  qrPlaceholderText: { color: '#334', fontSize: 11, textAlign: 'center', lineHeight: 16 },
  qrHint: { color: '#445', fontSize: 11 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  orLine: { flex: 1, height: 1, backgroundColor: '#111' },
  orText: { color: '#334', fontSize: 11, fontWeight: '600', letterSpacing: 1 },

  // Code
  codeCard: { alignItems: 'center', gap: 6, padding: 20, backgroundColor: 'rgba(91,91,214,0.07)', borderWidth: 1, borderColor: 'rgba(91,91,214,0.15)', borderRadius: 16, marginBottom: 16 },
  codeLabel: { color: '#5b5bd6', fontSize: 9, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' },
  codeValue: { fontSize: 44, fontWeight: '700', color: '#d0d0ff', letterSpacing: 10, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  refreshBtn: { paddingVertical: 5, paddingHorizontal: 14, borderRadius: 100, borderWidth: 1, borderColor: '#2a2a50' },
  refreshText: { color: '#5b5bd6', fontSize: 11 },

  // IP
  ipRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: '#111', borderRadius: 12, marginBottom: 16 },
  ipLabel: { color: '#334', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginRight: 6 },
  ipValue: { flex: 1, color: '#8888cc', fontSize: 16, fontWeight: '600', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', letterSpacing: 0.5 },
  ipPort: { color: '#5b5bd6', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },

  // Status
  statusCard: { padding: 14, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: '#111', borderRadius: 12, marginBottom: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { flex: 1, color: '#667', fontSize: 13 },
  rttPill: { paddingVertical: 2, paddingHorizontal: 8, backgroundColor: 'rgba(76,175,80,0.12)', borderRadius: 100, color: '#4caf50', fontSize: 11, fontWeight: '600' },

  // Recovery banner
  recoveryBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, backgroundColor: 'rgba(249,168,37,0.07)', borderWidth: 1, borderColor: 'rgba(249,168,37,0.25)', borderRadius: 14, marginBottom: 12 },
  recoveryTitle: { color: '#f9a825', fontSize: 13, fontWeight: '600' },
  recoverySub: { color: '#666', fontSize: 12, lineHeight: 17, marginTop: 2 },

  // Controller tabs
  tabBar: { flexDirection: 'row', gap: 6, paddingVertical: 6, marginBottom: 4, paddingHorizontal: 20 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: '#111', backgroundColor: 'rgba(255,255,255,0.02)' },
  tabActive: { borderColor: '#2a2a60', backgroundColor: 'rgba(91,91,214,0.1)' },
  tabIcon: { fontSize: 13 },
  tabLabel: { color: '#445', fontSize: 11, fontWeight: '600' },
  tabLabelActive: { color: '#9090d0' },
  tabContent: { gap: 14, paddingTop: 4 },

  // Discover
  discoverHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: 4 },
  discoverScanText: { color: '#445', fontSize: 12 },
  emptyDiscover: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyDiscoverEmoji: { fontSize: 42 },
  emptyDiscoverTitle: { color: '#667', fontSize: 15, fontWeight: '500' },
  emptyDiscoverSub: { color: '#334', fontSize: 12, textAlign: 'center', lineHeight: 18, paddingHorizontal: 20 },
  hostList: { gap: 10 },
  hostListLabel: { color: '#445', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  hostCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: 'rgba(0,188,140,0.05)', borderWidth: 1, borderColor: 'rgba(0,188,140,0.2)', borderRadius: 14 },
  hostCardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  hostCardName: { color: '#ccddcc', fontSize: 14, fontWeight: '600' },
  hostCardIp: { color: '#445', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  hostCardCode: { alignItems: 'center', gap: 1 },
  hostCardCodeLabel: { color: '#334', fontSize: 8, fontWeight: '700', letterSpacing: 1.2 },
  hostCardCodeValue: { color: '#00bc8c', fontSize: 14, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', letterSpacing: 2 },
  hostCardArrow: { color: '#00bc8c', fontSize: 16 },

  // QR scanner tab
  qrScanInstr: { color: '#445', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  cameraContainer: {
    height: 280,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1a1a30',
    position: 'relative',
  },
  cameraLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#080814',
  },
  cameraLoadingText: { color: '#445', fontSize: 13 },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Pulsing scan frame — replaces static scanFrame
  scanFrame: {
    width: 190,
    height: 190,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 10,
  },
  scanCorner: { position: 'absolute', width: 24, height: 24, borderColor: '#5b5bd6' },
  scanTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 4 },
  scanTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 4 },
  scanBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 4 },
  scanBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 4 },
  scanFrameHint: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },

  // Torch chip (top-right overlay)
  torchBtnWrap: { position: 'absolute', top: 12, right: 12 },
  torchChip: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  torchChipText: { color: '#fff', fontSize: 12 },

  scanError: { color: '#e53935', fontSize: 12, textAlign: 'center' },
  scanningRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  scanningText: { color: '#7c7cf0', fontSize: 12 },

  // Manual
  manualInstr: { color: '#445', fontSize: 12, lineHeight: 18 },
  manualField: { gap: 7 },
  manualLabel: { color: '#334', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  manualInput: { backgroundColor: '#080814', borderWidth: 1, borderColor: '#1a1a30', borderRadius: 12, color: '#c0c0e0', fontSize: 18, paddingVertical: 12, paddingHorizontal: 16, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', letterSpacing: 1 },
  connectBtn: { backgroundColor: '#5b5bd6', paddingVertical: 14, borderRadius: 100, alignItems: 'center', marginTop: 6, shadowColor: '#5b5bd6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6 },
  connectBtnOff: { opacity: 0.45, shadowOpacity: 0 },
  connectBtnText: { color: '#fff', fontSize: 14, fontWeight: '600', letterSpacing: 0.5 },

  // Info box
  infoBox: { backgroundColor: 'rgba(91,91,214,0.06)', borderWidth: 1, borderColor: 'rgba(91,91,214,0.15)', borderRadius: 12, padding: 14 },
  infoText: { color: '#667', fontSize: 12, lineHeight: 18 },
  infoEm: { color: '#9090d0', fontWeight: '600' },

  // Controller status bar
  ctrlStatus: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 8 },
  ctrlStatusInfo: { backgroundColor: 'rgba(91,91,214,0.06)', borderColor: 'rgba(91,91,214,0.2)' },
  ctrlStatusErr: { backgroundColor: 'rgba(229,57,53,0.06)', borderColor: 'rgba(229,57,53,0.2)' },
  ctrlStatusText: { color: '#889', fontSize: 12 },

  // Manual retry button
  retryBtn: { paddingVertical: 5, paddingHorizontal: 14, backgroundColor: 'rgba(91,91,214,0.2)', borderRadius: 100, borderWidth: 1, borderColor: '#5b5bd6', marginLeft: 8 },
  retryBtnText: { color: '#9090d0', fontSize: 12, fontWeight: '600' },

  // Navigating overlay
  navOverlay: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 28 },
  navText: { color: '#7c7cf0', fontSize: 14, fontWeight: '500' },
});