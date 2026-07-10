/**
 * VisionQRScanner.js — SAFE + FIXED (v5)
 */

import React, {
    useState,
    useEffect,
    useRef,
    useMemo,
    useCallback,
} from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Animated,
    Easing,
} from 'react-native';

import {
    Camera,
    useCameraDevice,
    useCameraPermission,
    useCodeScanner,
} from 'react-native-vision-camera';

export default function VisionQRScanner({
    isActive = true,
    onScanned,
    onError,
    debounceMs = 800,
    preferBack = true,
    style,
}) {
    // 🔴 HARD GUARD — prevents your crash
    const isScannerAvailable = true //typeof useCodeScanner === 'function';

    // ── Camera device ─────────────────────────────────────
    const backDevice = useCameraDevice('back');
    const frontDevice = useCameraDevice('front');
    const device = preferBack
        ? backDevice ?? frontDevice
        : frontDevice ?? backDevice;

    // ── Format selection ───────────────────────────────────
    const bestFormat = useMemo(() => {
        if (!device?.formats) return undefined;

        return device.formats.reduce((best, f) => {
            const pixels = (f.videoWidth || 0) * (f.videoHeight || 0);
            const bestPixels =
                (best?.videoWidth || 0) * (best?.videoHeight || 0);
            return pixels > bestPixels ? f : best;
        }, device.formats[0]);
    }, [device]);

    const targetFps = 30;

    // ── Permission ─────────────────────────────────────────
    const { hasPermission, requestPermission } = useCameraPermission();

    useEffect(() => {
        if (!hasPermission) requestPermission();
    }, [hasPermission]);

    // ── Scan state ─────────────────────────────────────────
    const lastScanAt = useRef(0);
    const [torch, setTorch] = useState('off');
    const [zoom, setZoom] = useState(0);
    const [scanned, setScanned] = useState(false);

    // ── SAFE scanner hook ──────────────────────────────────
    const codeScanner = isScannerAvailable
        ? useCodeScanner({
            codeTypes: ['qr'],
            onCodeScanned: codes => {
                if (!isActive || scanned) return;

                const now = Date.now();
                if (now - lastScanAt.current < debounceMs) return;
                lastScanAt.current = now;

                const value = codes?.[0]?.value;
                if (!value) return;

                setScanned(true);
                onScanned?.(value);
            },
        })
        : undefined;

    // ── Zoom animation ─────────────────────────────────────
    useEffect(() => {
        if (!device || !isActive || scanned) {
            setZoom(0);
            return;
        }

        let z = 0;
        let dir = 1;

        const id = setInterval(() => {
            z += dir * 0.08;
            if (z >= 2) dir = -1;
            if (z <= 0) dir = 1;
            setZoom(z);
        }, 140);

        return () => clearInterval(id);
    }, [device, isActive, scanned]);

    // ── Pulse animation ────────────────────────────────────
    const pulse = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 1,
                    duration: 700,
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    toValue: 0,
                    duration: 700,
                    useNativeDriver: true,
                }),
            ])
        );
        loop.start();
        return () => loop.stop();
    }, []);

    // ── PERMISSION SCREEN ──────────────────────────────────
    if (!hasPermission) {
        return (
            <View style={[s.container, style]}>
                <Text style={s.msgText}>Camera permission required</Text>
                <TouchableOpacity onPress={requestPermission}>
                    <Text style={s.btnText}>Grant</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // ── DEVICE LOADING ─────────────────────────────────────
    if (!device) {
        return (
            <View style={[s.container, style]}>
                <ActivityIndicator color="#fff" />
            </View>
        );
    }

    // 🔴 CRITICAL DEBUG SCREEN
    if (!isScannerAvailable) {
        return (
            <View style={[s.container, style]}>
                <Text style={s.errorText}>
                    useCodeScanner is NOT available
                </Text>
                <Text style={s.errorHint}>
                    Fix:
                    {'\n'}• remove barcode-scanner package
                    {'\n'}• install worklets-core
                    {'\n'}• rebuild app
                </Text>
            </View>
        );
    }

    // ── CAMERA ─────────────────────────────────────────────
    return (
        <View style={[s.container, style]}>
            <Camera
                style={StyleSheet.absoluteFill}
                device={device}
                isActive={isActive && !scanned}
                format={bestFormat}
                fps={targetFps}
                codeScanner={codeScanner}
                zoom={zoom}
                torch={torch}
            />

            {/* Overlay */}
            <View style={s.overlay}>
                <Animated.View
                    style={[
                        s.box,
                        {
                            transform: [
                                {
                                    scale: pulse.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [1, 1.05],
                                    }),
                                },
                            ],
                        },
                    ]}
                />
            </View>

            {/* Torch */}
            <TouchableOpacity
                style={s.torch}
                onPress={() =>
                    setTorch(t => (t === 'off' ? 'on' : 'off'))
                }>
                <Text style={{ color: '#fff' }}>
                    {torch === 'off' ? 'Torch On' : 'Torch Off'}
                </Text>
            </TouchableOpacity>
        </View>
    );
}

// ── Styles ──────────────────────────────────────────────
const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },

    msgText: { color: '#fff', textAlign: 'center' },
    btnText: { color: '#7c7cf0', marginTop: 10 },

    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },

    box: {
        width: 220,
        height: 220,
        borderWidth: 2,
        borderColor: '#fff',
    },

    torch: {
        position: 'absolute',
        top: 40,
        right: 20,
    },

    errorText: {
        color: 'red',
        fontSize: 16,
        textAlign: 'center',
    },

    errorHint: {
        color: '#ccc',
        marginTop: 10,
        textAlign: 'center',
    },
});