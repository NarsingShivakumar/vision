import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, ScrollView,
    SafeAreaView, Alert, NativeModules, AppState,
} from 'react-native';
import { PERMISSIONS, RESULTS, check } from 'react-native-permissions';
import { generateRoomCode } from '../utils/roomCode';
import { SignalingService } from '../services/SignalingService';
import { WebRTCService } from '../services/WebRTCService';
import { StorageService } from '../services/StorageService';
import { DiscoveryService } from '../services/DiscoveryService';
import { MSG } from '../utils/constants';
import StatsBar from '../components/StatsBar';
import ConsentDialog from '../components/ConsentDialog';
import ReconnectBanner from '../components/ReconnectBanner';

const { MediaProjectionModule } = NativeModules;

export default function ShareScreen({ navigation }) {
    const [step, setStep] = useState('setup');   // setup | waiting | streaming | stopped
    const [roomCode] = useState(() => generateRoomCode());
    const [serverIp, setServerIp] = useState('');
    const [connState, setConnState] = useState('idle');
    const [stats, setStats] = useState({ bitrate: 0, fps: 0, rtt: 0 });
    const [elapsed, setElapsed] = useState(0);
    const [settings, setSettings] = useState(null);
    const [showConsent, setShowConsent] = useState(false);
    const [pendingControlConsent, setPendingControlConsent] = useState(false);
    const localStream = useRef(null);
    const timerRef = useRef(null);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        StorageService.getSettings().then(s => {
            setSettings(s);
            setServerIp(s.lastServerIp || '');
        });
        return () => {
            mounted.current = false;
            _cleanup();
        };
    }, []);

    // Handle app going to background during stream
    useEffect(() => {
        const sub = AppState.addEventListener('change', state => {
            if (state === 'background' && step === 'streaming') {
                // Foreground service keeps capture alive — no action needed
            }
        });
        return () => sub.remove();
    }, [step]);

    const startSharing = useCallback(async () => {
        // 1. Check audio permission if needed
        if (settings?.audioEnabled) {
            const audioStatus = await check(PERMISSIONS.ANDROID.RECORD_AUDIO);
            if (audioStatus !== RESULTS.GRANTED) {
                Alert.alert('Permission needed', 'Microphone permission is required for audio streaming. Enable it in Permissions screen.');
                return;
            }
        }

        // 2. Show consent dialog
        setShowConsent(true);
    }, [settings]);

    const onConsentAccepted = useCallback(async () => {
        setShowConsent(false);
        try {
            // 3. Request MediaProjection — shows system dialog for screen capture approval
            const resultCode = await MediaProjectionModule.requestScreenCapture();
            if (!resultCode) {
                Alert.alert('Screen Capture Denied', 'You must accept the screen capture permission to share your screen.');
                return;
            }

            // 4. Start foreground service + get screen media stream
            const stream = await MediaProjectionModule.startCapture(
                resultCode,
                settings?.videoBitrate || 2000,
                settings?.videoFps || 30,
                settings?.audioEnabled || false,
            );
            localStream.current = stream;

            // 5. Connect to signaling server
            const ip = serverIp.trim() || '192.168.1.100';
            await SignalingService.connect(`http://${ip}:3838`);
            SignalingService.emit(MSG.JOIN_ROOM, { roomCode, role: 'host' });

            // 6. Start LAN advertising so controller can find this device
            DiscoveryService.startAdvertising(roomCode, settings?.deviceName || 'My Device');

            // 7. Set up WebRTC when peer joins
            SignalingService.on(MSG.PEER_JOINED, async () => {
                await WebRTCService.createPeerConnection(true);
                WebRTCService.onConnState(s => mounted.current && setConnState(s));
                WebRTCService.onStats(raw => {
                    if (!mounted.current) return;
                    setStats(raw);
                });

                // Listen for remote control consent request from controller
                WebRTCService.onControlMessage(msg => {
                    if (msg.type === MSG.CTRL_CONSENT_REQUEST) {
                        setPendingControlConsent(true);
                    }
                });

                stream.getTracks().forEach(t => WebRTCService.addTrack(t, stream));
                const offer = await WebRTCService.createOffer();
                SignalingService.emit(MSG.OFFER, { offer });
                setConnState('connecting');
            });

            SignalingService.on(MSG.ANSWER, async ({ answer }) => {
                await WebRTCService.setAnswer(answer);
                setConnState('connected');
                setStep('streaming');
                _startTimer();
                await StorageService.addPairEntry({ roomCode, deviceName: 'Controller', ip });
            });

            SignalingService.on(MSG.ICE_CANDIDATE, ({ candidate }) => WebRTCService.addIceCandidate(candidate));
            SignalingService.on(MSG.PEER_LEFT, () => setConnState('peer_left'));
            SignalingService.on('disconnect', () => setConnState('disconnected'));

            setStep('waiting');
        } catch (e) {
            console.error('[ShareScreen] start error:', e);
            Alert.alert('Error', e.message || 'Failed to start screen sharing.');
        }
    }, [serverIp, roomCode, settings]);

    const stopSharing = useCallback(async () => {
        Alert.alert('Stop Sharing', 'Are you sure you want to stop sharing your screen?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Stop', style: 'destructive', onPress: _cleanup },
        ]);
    }, []);

    function _cleanup() {
        _stopTimer();
        DiscoveryService.stopAdvertising();
        WebRTCService.close();
        SignalingService.disconnect();
        try { MediaProjectionModule?.stopCapture(); } catch { }
        if (mounted.current) setStep('setup');
    }

    function _startTimer() {
        setElapsed(0);
        timerRef.current = setInterval(() => {
            if (mounted.current) setElapsed(e => e + 1);
        }, 1000);
    }
    function _stopTimer() { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } }

    const onControlConsentAccepted = () => {
        setPendingControlConsent(false);
        WebRTCService.sendControl({ type: MSG.CTRL_CONSENT_ACK, granted: true });
    };
    const onControlConsentDenied = () => {
        setPendingControlConsent(false);
        WebRTCService.sendControl({ type: MSG.CTRL_CONSENT_ACK, granted: false });
    };

    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');

    return (
        <SafeAreaView style={s.safe}>
            <ReconnectBanner connState={connState} onReconnect={onConsentAccepted} />

            <ScrollView contentContainerStyle={s.scroll}>
                {step === 'setup' && (
                    <View style={s.section}>
                        <Text style={s.label}>Signaling Server IP</Text>
                        <Text style={s.hint}>Enter the IP of the device running the signaling server (see README). Both devices must be on the same Wi-Fi.</Text>
                        <View style={s.inputWrap}>
                            <Text style={s.inputPfx}>http://</Text>
                            {/* TextInput for serverIp */}
                            <Text style={s.inputVal}>{serverIp || '192.168.x.x'}</Text>
                            <Text style={s.inputSfx}>:3838</Text>
                        </View>
                        <TouchableOpacity style={s.primaryBtn} onPress={startSharing}>
                            <Text style={s.primaryBtnTxt}>📡 Start Sharing</Text>
                        </TouchableOpacity>
                        <Text style={s.codeInfo}>Room code: <Text style={s.code}>{roomCode}</Text></Text>
                    </View>
                )}

                {step === 'waiting' && (
                    <View style={s.center}>
                        <Text style={s.waitIcon}>📡</Text>
                        <Text style={s.waitTitle}>Waiting for viewer…</Text>
                        <Text style={s.waitSub}>Share this room code with the controller device:</Text>
                        <View style={s.codeBox}><Text style={s.codeBoxTxt}>{roomCode}</Text></View>
                        <Text style={s.waitHint}>Or the controller can discover this device automatically on the same Wi-Fi.</Text>
                        <TouchableOpacity style={s.stopBtn} onPress={_cleanup}>
                            <Text style={s.stopBtnTxt}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {step === 'streaming' && (
                    <View style={s.streamingPanel}>
                        <Text style={s.streamIcon}>🟢</Text>
                        <Text style={s.streamTitle}>Screen is being shared</Text>
                        <Text style={s.timer}>{mm}:{ss}</Text>
                        <View style={s.statsWrap}>
                            <StatsBar stats={stats} connState={connState} elapsed={elapsed} />
                        </View>
                        <TouchableOpacity style={s.stopBtn} onPress={stopSharing}>
                            <Text style={s.stopBtnTxt}>⏹ Stop Sharing</Text>
                        </TouchableOpacity>
                        <Text style={s.roomCodeSmall}>Room: {roomCode}</Text>
                    </View>
                )}
            </ScrollView>

            {/* Screen share consent dialog */}
            <ConsentDialog
                visible={showConsent}
                type="screen_share"
                onAccept={onConsentAccepted}
                onDecline={() => setShowConsent(false)}
            />

            {/* Remote control consent dialog (from controller request) */}
            <ConsentDialog
                visible={pendingControlConsent}
                type="remote_control"
                onAccept={onControlConsentAccepted}
                onDecline={onControlConsentDenied}
            />
        </SafeAreaView>
    );
}

const s = StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#0f1120' },
    scroll: { padding: 20 },
    section: {},
    label: { fontSize: 13, fontWeight: '700', color: '#8892a4', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
    hint: { fontSize: 13, color: '#666e8a', marginBottom: 12, lineHeight: 20 },
    inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1c2035', borderRadius: 12, padding: 14, marginBottom: 16 },
    inputPfx: { color: '#555e7a', fontSize: 14 },
    inputVal: { flex: 1, color: '#e0e6f5', fontSize: 15, fontWeight: '600' },
    inputSfx: { color: '#555e7a', fontSize: 14 },
    primaryBtn: { backgroundColor: '#1565c0', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 12 },
    primaryBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 17 },
    codeInfo: { textAlign: 'center', color: '#555e7a', fontSize: 13 },
    code: { color: '#60b3ff', fontWeight: '700' },
    center: { alignItems: 'center', paddingVertical: 40 },
    waitIcon: { fontSize: 56, marginBottom: 16 },
    waitTitle: { fontSize: 22, fontWeight: '800', color: '#e0e6f5', marginBottom: 8 },
    waitSub: { fontSize: 14, color: '#8892a4', marginBottom: 16 },
    codeBox: { backgroundColor: '#1c2035', borderRadius: 16, paddingHorizontal: 32, paddingVertical: 18, marginBottom: 14, borderWidth: 2, borderColor: '#1565c0' },
    codeBoxTxt: { fontSize: 36, fontWeight: '900', color: '#60b3ff', letterSpacing: 8 },
    waitHint: { fontSize: 12, color: '#555e7a', textAlign: 'center', marginBottom: 24 },
    stopBtn: { backgroundColor: '#b71c1c', borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14 },
    stopBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
    streamingPanel: { alignItems: 'center', paddingVertical: 40 },
    streamIcon: { fontSize: 48, marginBottom: 12 },
    streamTitle: { fontSize: 20, fontWeight: '800', color: '#e0e6f5', marginBottom: 4 },
    timer: { fontSize: 44, fontWeight: '900', color: '#60b3ff', fontVariant: ['tabular-nums'], marginBottom: 16 },
    statsWrap: { marginBottom: 24 },
    roomCodeSmall: { marginTop: 16, fontSize: 13, color: '#555e7a' },
});