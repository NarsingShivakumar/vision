/**
 * PatientScreen.js v8.5 — Validation hardening on registration form
 *
 * Changes from v8.4:
 * - FIX: Name field: minLength 2, required, trims before validation
 * - FIX: Mobile: required, exactly 10 digits enforced via pattern AND
 *        a custom `validate` that checks length < 10 with a distinct message,
 *        maxLength={10} kept on TextInput so keyboard never allows >10
 * - FIX: Age: range 1–120, numeric-only pattern, NOT required (still optional)
 *        but if filled must be valid — empty string bypasses min/max/pattern
 *        correctly via conditional validate
 * - FIX: Gender: required, already had rule — no change needed
 * - FIX: "Next — Choose Assistant" button: disabled unless react-hook-form
 *        `isValid` is true.  Changed form `mode` to 'all' so validation runs
 *        on both onChange AND onBlur, which means the button stays disabled
 *        until every required field has been touched and is valid.
 *        Previously 'onChange' mode left isValid=false on first render because
 *        required fields hadn't been touched yet — the button appeared disabled
 *        correctly but errors only showed after the user typed, not on blur.
 *        With 'all', errors show on blur AND the button state is reliable.
 *
 * All other logic identical to v8.4.
 */

/**
 * PatientScreen.js v8.6 — auth_sync from Controller
 *
 * Changes from v8.5:
 * - ADD: listener for 'auth_sync' event from controller (HOST only)
 *        Receives { kioskId, loginInfo, token } and persists them to AsyncStorage
 *        using the same keys as KioskSetupScreen + Login.js so that the host
 *        device is authenticated after the controller completes login.
 *        Stores: isFirstTimeLaunch, kioskId, loginResponseEntityToken,
 *                loginInfo, isLoggedIn, doctorId
 * - All other logic identical to v8.5.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, StatusBar, BackHandler,
  KeyboardAvoidingView, Platform, Dimensions, ActivityIndicator,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';

import AsyncStorage from '@react-native-async-storage/async-storage';
import socketService from '../services/socketService';
import webRTCService from '../services/webRTCService';
import calibrationService from '../services/calibrationService';
import localPeerService, { PEER_ROLE } from '../services/localPeerService';
import WifiGuard from '../components/WifiGuard';
import { useWifiGuard } from '../hooks/useWifiGuard';
import { generatePlateDots, getPlate, TOTAL_PLATES, preloadIshiharaPlates } from '../utils/ishiharaPanel';
import SplitVRLayout from '../components/SplitVRLayout';
import { useTTS } from '../hooks/useTTS';
import apiService from '../../api/AxiosClient';
import { fetchActiveAssistantsApi, getResultPdfUri, submitRegistrationApi } from '../../api/ApiService';
// import apiService from '../../AxiosClient';
let Orientation = null;
let KeepAwake = null;
let SystemNavigationBar = null;
let ScreenBrightness = null;

try { Orientation = require('react-native-orientation-locker').default; } catch { }
try { KeepAwake = require('react-native-keep-awake').default; } catch { }
try { SystemNavigationBar = require('react-native-system-navigation-bar').default; } catch { }
try { ScreenBrightness = require('react-native-screen-brightness'); } catch { }

const ALLERGY_OPTIONS = [
  { key: 'allergyNITT', label: 'NITT' },
  { key: 'allergyPenicillin', label: 'Penicillin' },
  { key: 'allergyXylocaine', label: 'Xylocaine' },
  { key: 'allergySulpha', label: 'Sulpha' },
  { key: 'allergyAtropine', label: 'Atropine' },
  { key: 'allergyDropsyn', label: 'Dropsyn' },
];

const INITIAL_ALLERGIES = {
  allergyNITT: false, allergyPenicillin: false, allergyXylocaine: false,
  allergySulpha: false, allergyAtropine: false, allergyDropsyn: false,
};

export default function PatientScreen({ route, navigation }) {
  const deviceRole = route?.params?.deviceRole ?? null;
  const isVRHost = deviceRole === PEER_ROLE.HOST;

  const [view, setView] = useState(isVRHost ? 'host_waiting' : 'registration');
  const [regStep, setRegStep] = useState('details');
  const [activeAssistants, setActiveAssistants] = useState([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState('');
  const [loadingAssistants, setLoadingAssistants] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const [roomCode, setRoomCode] = useState('');
  const [patientName, setPatientName] = useState('');
  const [phase, setPhase] = useState('waiting');
  const [instruction, setInstruction] = useState('Waiting for the assistant to start the test\u2026');
  const [isComplete, setIsComplete] = useState(false);
  const [optotype, setOptotype] = useState(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackSeen, setFeedbackSeen] = useState(false);
  const [isLensCheck, setIsLensCheck] = useState(false);
  const [lensCheckEye, setLensCheckEye] = useState('both');
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [colorShowLeft, setColorShowLeft] = useState(true);
  const [colorShowRight, setColorShowRight] = useState(true);
  const [nearShowLeft, setNearShowLeft] = useState(true);
  const [nearShowRight, setNearShowRight] = useState(true);
  const [astigShowLeft, setAstigShowLeft] = useState(true);
  const [astigShowRight, setAstigShowRight] = useState(true);
  const [nearOptotype, setNearOptotype] = useState(null);
  const [plateIndex, setPlateIndex] = useState(0);
  const [plateDots, setPlateDots] = useState([]);
  const [rtcState, setRtcState] = useState({
    isMuted: false, isConnected: false,
    isInitialising: false, hasError: false, errorMessage: '',
  });
  const [parallax, setParallax] = useState(null);
  const [peerConnected, setPeerConnected] = useState(localPeerService.isConnected());
  const [assistantDisconnected, setAssistantDisconnected] = useState(false);

  // ── React Hook Form Setup ─────────────────────────────────────────────────
  // mode: 'all' = validate on both onChange and onBlur
  // This ensures:
  //   • Error messages appear as soon as the user leaves a field (blur)
  //   • The Next button stays disabled until EVERY required field is valid
  //   • Inline errors update instantly while the user is still typing (onChange)
  const {
    control,
    handleSubmit,
    getValues,
    setValue,
    watch,
    reset,
    formState: { errors, isValid }
  } = useForm({
    mode: 'all',           // ← changed from 'onChange' to 'all'
    defaultValues: {
      regName: '',
      regAge: '',
      regMobile: '',
      regGender: '',
      regGlasses: false,
      regAllergies: { ...INITIAL_ALLERGIES },
    }
  });

  const feedbackTimer = useRef(null);
  const socketUnsubs = useRef([]);
  const peerUnsubs = useRef([]);
  const previousBrightness = useRef(null);
  const roomCodeRef = useRef('');
  const viewRef = useRef(isVRHost ? 'host_waiting' : 'registration');
  const enterVRRef = useRef(null);
  const isCompleteRef = useRef(false);

  const setViewSynced = useCallback((v) => {
    viewRef.current = v;
    setView(v);
  }, []);

  const { speak, speakPhase, resetEyeState } = useTTS();

  useWifiGuard();

  const handleWifiRestore = useCallback(() => {
    if (isVRHost) localPeerService.ensureServerAlive();
  }, [isVRHost]);

  const broadcastVRState = useCallback((patch) => {
    if (!isVRHost) return;
    localPeerService.send('vr_state_update', patch);
  }, [isVRHost]);

  // ── Immersive helpers ─────────────────────────────────────────────────────
  const enableTestFullscreen = useCallback(async () => {
    try { Orientation?.lockToLandscape(); } catch { }
    try { KeepAwake?.activate(); } catch { }
    if (Platform.OS === 'android') {
      try { await SystemNavigationBar?.stickyImmersive?.(); } catch {
        try { await SystemNavigationBar?.immersive?.(); } catch { }
      }
      try { StatusBar.setHidden(true, 'fade'); } catch { }
    } else {
      try { StatusBar.setHidden(true, 'fade'); } catch { }
    }
    try {
      if (ScreenBrightness?.getBrightness && ScreenBrightness?.setBrightness) {
        const current = await ScreenBrightness.getBrightness();
        previousBrightness.current = current;
        await ScreenBrightness.setBrightness(0.7);
      }
    } catch { }
  }, []);

  const disableTestFullscreen = useCallback(async () => {
    try { Orientation?.unlockAllOrientations(); } catch { }
    try { KeepAwake?.deactivate(); } catch { }
    if (Platform.OS === 'android') {
      try { await SystemNavigationBar?.show?.(); } catch { }
      try { StatusBar.setHidden(false, 'fade'); } catch { }
    } else {
      try { StatusBar.setHidden(false, 'fade'); } catch { }
    }
    try {
      if (ScreenBrightness?.setBrightness && previousBrightness.current != null) {
        await ScreenBrightness.setBrightness(previousBrightness.current);
        previousBrightness.current = null;
      }
    } catch { }
  }, []);

  // ── Mount ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    calibrationService.autoDetectPpi();
    preloadIshiharaPlates();
    loadPlate(0);

    if (isVRHost) {
      attachLocalPeerListeners();
    } else {
      const room = route?.params?.roomCode;
      if (room) {
        roomCodeRef.current = room;
        setRoomCode(room);
        setViewSynced('ready');
      } else {
        fetchAssistants();
      }
    }

    return () => {
      socketUnsubs.current.forEach(fn => fn?.());
      peerUnsubs.current.forEach(fn => fn?.());
      webRTCService.disconnect();
      socketService.disconnect();
      clearTimeout(feedbackTimer.current);
      disableTestFullscreen();
    };
  }, []);

  useEffect(() => {
    if (view === 'vr') enableTestFullscreen();
    else disableTestFullscreen();
  }, [view, enableTestFullscreen, disableTestFullscreen]);

  useEffect(() => {
    const unsub = webRTCService.onStateChange((state) => {
      setRtcState(state);
      if (isVRHost && state.isConnected) {
        localPeerService.send('webrtc_event', { connected: state.isConnected, muted: state.isMuted });
      }
    });
    return () => unsub();
  }, [isVRHost]);

  useEffect(() => {
    let sub;
    try {
      const { gyroscope } = require('react-native-sensors');
      sub = gyroscope.subscribe(({ x: beta, y: gamma }) => {
        const g = Math.max(-25, Math.min(25, gamma * (180 / Math.PI)));
        const b = Math.max(-25, Math.min(25, beta * (180 / Math.PI)));
        setParallax(calibrationService.computeParallax(g, b));
      });
    } catch { }
    return () => sub?.unsubscribe?.();
  }, []);

  useEffect(() => {
    if (view !== 'vr') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [view]);

  // ── Plate loader ──────────────────────────────────────────────────────────
  const loadPlate = useCallback((index) => {
    const plate = getPlate(index);
    setPlateDots(generatePlateDots(plate));
    setPlateIndex(index);
  }, []);

  const fetchAssistants = useCallback(async () => {
    setLoadingAssistants(true);
    try {
      const list = await fetchActiveAssistantsApi();
      setActiveAssistants(Array.isArray(list) ? list : []);
    } catch { setActiveAssistants([]); }
    finally { setLoadingAssistants(false); }
  }, []);

  // Fired by handleSubmit when Step 1 is valid
  const onDetailsSubmit = () => {
    setRegStep('assistant');
    fetchAssistants();
  };

  const submitRegistration = useCallback(async () => {
    if (!selectedAssistantId || submitting) return;
    setSubmitting(true); setSubmitError('');

    const formData = getValues();

    const payload = {
      patientName: formData.regName.trim(),
      patientAge: formData.regAge ? Number(formData.regAge) : null,
      patientGender: formData.regGender,
      mobileNumber: formData.regMobile.trim(),
      wearingGlasses: formData.regGlasses,
      assistantId: selectedAssistantId,
      ...formData.regAllergies,
    };

    try {
      const res = await submitRegistrationApi(payload);
      const rc = res.roomCode;
      roomCodeRef.current = rc;
      setRoomCode(rc);
      setPatientName(res.patientName ?? formData.regName.trim());
      setViewSynced('ready');
    } catch (err) {
      setSubmitError(err?.response?.data?.message ?? err?.message ?? 'Could not start session. Please try again.');
    } finally { setSubmitting(false); }
  }, [selectedAssistantId, submitting, getValues, setViewSynced]);

  const returnToRegistration = useCallback((msg = '') => {
    clearTimeout(feedbackTimer.current);
    feedbackTimer.current = null;
    socketUnsubs.current.forEach(fn => fn?.());
    socketUnsubs.current = [];
    webRTCService.disconnect();
    socketService.disconnect();
    disableTestFullscreen();

    const nextView = isVRHost ? 'host_waiting' : 'registration';
    viewRef.current = nextView;
    setView(nextView);

    setRegStep('details'); setSelectedAssistantId(''); setSubmitError(msg);
    roomCodeRef.current = '';
    setRoomCode('');
    setIsComplete(false);
    isCompleteRef.current = false;
    setPhase('waiting');
    setInstruction('Waiting for the assistant to start the test\u2026');
    setPatientName(''); setOptotype(null); setNearOptotype(null);
    setShowFeedback(false); setFeedbackSeen(false);
    setShowLeft(true); setShowRight(true);
    setColorShowLeft(true); setColorShowRight(true);
    setNearShowLeft(true); setNearShowRight(true);
    setAstigShowLeft(true); setAstigShowRight(true);
    setParallax(null);
    setRtcState({ isMuted: false, isConnected: false, isInitialising: false, hasError: false, errorMessage: '' });
    setIsLensCheck(false); setLensCheckEye('both');
    setAssistantDisconnected(false);
    loadPlate(0);
    reset();

    if (isVRHost) broadcastVRState({
      phase: 'waiting', isComplete: false,
      instruction: 'Waiting\u2026',
      assistantDisconnected: false,
    });
  }, [disableTestFullscreen, loadPlate, isVRHost, broadcastVRState, reset]);

  const handleCloseSession = useCallback(() => returnToRegistration(''), [returnToRegistration]);

  const handleSelfDisconnect = useCallback(() => {
    localPeerService.send('peer_self_disconnect', {});
    setTimeout(() => {
      socketService.disconnect();
      webRTCService.disconnect();
      localPeerService.destroy();
      navigation.replace('RoleAndConnectScreen');
    }, 150);
  }, [navigation]);

  // ── Enter VR ──────────────────────────────────────────────────────────────
  const enterVR = useCallback(() => {
    const code = roomCodeRef.current;
    if (!code) {
      console.warn('[PatientScreen] enterVR called but roomCodeRef is empty');
      return;
    }
    speak('Connecting to session. Please wait.');
    viewRef.current = 'vr';
    setView('vr');
    socketService.connect('patient');
    attachSocketListeners(code);
    socketService.onConnected(() => {
      socketService.emit('vr_join_session', { roomCode: code });
    });
  }, [speak]);

  enterVRRef.current = enterVR;

  // ── Local peer listeners (VR Host only) ──────────────────────────────────
  function attachLocalPeerListeners() {
    const P = peerUnsubs.current;

    P.push(localPeerService.on('connected', () => {
      console.log('[PatientScreen] peer connected');
      setPeerConnected(true);
    }));

    P.push(localPeerService.on('disconnected', () => {
      console.log('[PatientScreen] peer disconnected');
      setPeerConnected(false);
    }));

    P.push(localPeerService.on('session_registered', (data) => {
      const { roomCode: rc, patientName: pn } = data;
      console.log('[PatientScreen] session_registered rc:', rc);
      roomCodeRef.current = rc;
      setRoomCode(rc);
      setPatientName(pn ?? '');
      viewRef.current = 'ready';
      setView('ready');
    }));

    P.push(localPeerService.on('start_test', () => {
      console.log('[PatientScreen] start_test. viewRef:', viewRef.current, 'roomCode:', roomCodeRef.current);
      if (roomCodeRef.current && viewRef.current === 'ready') {
        enterVRRef.current();
      } else {
        console.warn('[PatientScreen] start_test ignored — view:', viewRef.current, 'roomCode:', roomCodeRef.current);
      }
    }));

    P.push(localPeerService.on('end_session', () => {
      returnToRegistration('Session ended by controller.');
    }));

    P.push(localPeerService.on('peer_self_disconnect', () => {
      socketService.disconnect();
      webRTCService.disconnect();
      localPeerService.destroy();
      navigation.replace('RoleAndConnectScreen');
    }));

    // ── NEW: auth_sync — controller sends credentials after login ─────────────
    // Persists the same AsyncStorage keys that KioskSetupScreen + Login.js write
    // so the HOST device is fully authenticated without requiring its own login.
    P.push(localPeerService.on('auth_sync', async (data) => {
      try {
        const { kioskId = '', loginInfo = '', token = '' } = data;
        console.log('[PatientScreen] auth_sync received — storing credentials for kioskId:', kioskId);
        // Sequential setItem — same pattern as Login.js (avoids multiSet bridgeless issues)
        await AsyncStorage.setItem('isFirstTimeLaunch', 'true');
        await AsyncStorage.setItem('kioskId', String(kioskId));
        await AsyncStorage.setItem('loginResponseEntityToken', String(token));
        await AsyncStorage.setItem('loginInfo', String(loginInfo));
        await AsyncStorage.setItem('isLoggedIn', '1');
        await AsyncStorage.setItem('doctorId', '');
        console.log('[PatientScreen] auth_sync — credentials stored successfully');
      } catch (e) {
        console.error('[PatientScreen] auth_sync — failed to store credentials:', e);
      }
    }));
  }

  // ── Socket listeners ──────────────────────────────────────────────────────
  function attachSocketListeners(code) {
    const U = socketUnsubs.current;

    U.push(socketService.on('session_joined', async (data) => {
      const name = data.patientName ?? '';
      setPatientName(name);
      setPhase(data.phase ?? 'waiting');
      speak(name ? `Welcome, ${name}. Be ready for the test.` : 'Welcome. Be ready for the test.');
      await webRTCService.initAudio('patient', code);
      broadcastVRState({ phase: data.phase ?? 'waiting', patientName: name });
      localPeerService.send('vr_session_started', { patientName: name });
    }));

    U.push(socketService.on('set_calibration', (data) => {
      calibrationService.setProfile({
        ipdMm: data.ipdMm ?? 63,
        lensMagnification: data.lensMagnification ?? 1.0,
        physicalDistanceMm: data.physicalDistanceMm ?? 350,
      });
      if (data.autoPpi) calibrationService.autoDetectPpi();
    }));

    U.push(socketService.on('mute_patient', (data) => { webRTCService.forceLocalMute(data.muted); }));
    U.push(socketService.on('webrtc_ping', () => { socketService.emit('vr_webrtc_patient_ready', { roomCode: code }); }));

    U.push(socketService.on('session_error', (data) => {
      const msg = data?.message ?? 'Could not join session.';
      speak(msg); returnToRegistration(msg);
    }));

    U.push(socketService.on('show_instruction', (data) => {
      setIsLensCheck(false); setLensCheckEye('both');
      setInstruction(data.message); setPhase('waiting'); setOptotype(null);
      speak(data.message);
      broadcastVRState({ instruction: data.message, phase: 'waiting', optotype: null, isLensCheck: false });
    }));

    U.push(socketService.on('lens_check', (data) => {
      const eye = data?.eye ?? 'both';
      setPhase('waiting'); setIsComplete(false); setOptotype(null); setNearOptotype(null);
      setIsLensCheck(true); setLensCheckEye(eye);
      setShowLeft(eye === 'left' || eye === 'both');
      setShowRight(eye === 'right' || eye === 'both');
      setInstruction('Adjust the headset until the circles are centered and clear.');
      broadcastVRState({ isLensCheck: true, lensCheckEye: eye, instruction: 'Lens alignment', phase: 'waiting' });
    }));

    U.push(socketService.on('session_closed', (data) => {
      setIsComplete(true);
      isCompleteRef.current = true;
      setPhase('complete');
      const msg = data?.message ?? 'The screening session has been completed. Thank you!';
      setInstruction(msg); speak(msg);
      broadcastVRState({ isComplete: true, phase: 'complete', instruction: msg });
    }));

    U.push(socketService.on('session_ended', (data) => {
      const msg = data?.message ?? 'This session has already been completed.';
      speak(msg); returnToRegistration(msg);
    }));

    U.push(socketService.on('phase_changed', (data) => {
      const p = data.phase;
      setIsLensCheck(false); setLensCheckEye('both');
      setPhase(p); setOptotype(null); resetEyeState(); speakPhase(p);
      if (p === 'astigmatism') { setAstigShowLeft(true); setAstigShowRight(true); }
      if (p === 'color') { loadPlate(0); setColorShowLeft(true); setColorShowRight(true); }
      if (p === 'near') { setNearShowLeft(true); setNearShowRight(true); setNearOptotype(null); }
      broadcastVRState({
        phase: p, isLensCheck: false, optotype: null, nearOptotype: null,
        showLeft: true, showRight: true, colorShowLeft: true, colorShowRight: true,
        nearShowLeft: true, nearShowRight: true, astigShowLeft: true, astigShowRight: true,
        plateIndex: p === 'color' ? 0 : plateIndex,
      });
    }));

    U.push(socketService.on('show_color_plate', (data) => {
      loadPlate(data?.plateIndex ?? 0);
      broadcastVRState({ plateIndex: data?.plateIndex ?? 0 });
    }));

    U.push(socketService.on('show_color_eye', (data) => {
      const eye = data?.eye ?? 'both';
      setColorShowLeft(eye === 'left' || eye === 'both');
      setColorShowRight(eye === 'right' || eye === 'both');
      broadcastVRState({ colorShowLeft: eye === 'left' || eye === 'both', colorShowRight: eye === 'right' || eye === 'both' });
    }));

    U.push(socketService.on('show_near_eye', (data) => {
      const eye = data?.eye ?? 'both';
      setNearShowLeft(eye === 'left' || eye === 'both');
      setNearShowRight(eye === 'right' || eye === 'both');
      broadcastVRState({ nearShowLeft: eye === 'left' || eye === 'both', nearShowRight: eye === 'right' || eye === 'both' });
    }));

    U.push(socketService.on('show_optotype', (data) => {
      const normalized = {
        roomCode: data?.roomCode ?? code,
        phase: data?.phase ?? 'acuity',
        letter: data?.letter ?? 'E',
        rotation: typeof data?.rotation === 'number' ? data.rotation : 0,
        sizeLevel: typeof data?.sizeLevel === 'number' ? data.sizeLevel : 0,
        eye: data?.eye ?? 'both',
        acuityLabel: data?.acuityLabel ?? '',
      };

      if (normalized.phase === 'color') {
        const eye = normalized.eye ?? 'both';
        setColorShowLeft(eye === 'left' || eye === 'both');
        setColorShowRight(eye === 'right' || eye === 'both');
        if (normalized.sizeLevel != null) loadPlate(normalized.sizeLevel);
        broadcastVRState({ colorShowLeft: eye === 'left' || eye === 'both', colorShowRight: eye === 'right' || eye === 'both', plateIndex: normalized.sizeLevel });
        return;
      }

      if (normalized.phase === 'near') {
        const eye = normalized.eye ?? 'both';
        setTimeout(() => {
          setNearOptotype({ letter: normalized.letter, sizeLevel: normalized.sizeLevel, acuityLabel: normalized.acuityLabel });
          setNearShowLeft(eye === 'left' || eye === 'both');
          setNearShowRight(eye === 'right' || eye === 'both');
          broadcastVRState({
            nearOptotype: { letter: normalized.letter, sizeLevel: normalized.sizeLevel, acuityLabel: normalized.acuityLabel },
            nearShowLeft: eye === 'left' || eye === 'both',
            nearShowRight: eye === 'right' || eye === 'both',
          });
        }, 120);
        return;
      }

      if (normalized.phase === 'astigmatism') {
        const eye = normalized.eye ?? 'both';
        setAstigShowLeft(eye === 'left' || eye === 'both');
        setAstigShowRight(eye === 'right' || eye === 'both');
        broadcastVRState({ astigShowLeft: eye === 'left' || eye === 'both', astigShowRight: eye === 'right' || eye === 'both' });
        return;
      }

      setShowFeedback(false);
      setTimeout(() => {
        setOptotype(normalized);
        const eye = normalized.eye ?? 'both';
        setShowLeft(eye === 'left' || eye === 'both');
        setShowRight(eye === 'right' || eye === 'both');
        broadcastVRState({ optotype: normalized, showLeft: eye === 'left' || eye === 'both', showRight: eye === 'right' || eye === 'both' });
      }, 120);
    }));

    U.push(socketService.on('response_recorded', (data) => {
      setFeedbackSeen(data.seen); setShowFeedback(true);
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(() => setShowFeedback(false), 500);
    }));

    U.push(socketService.on('test_complete', () => {
      setIsComplete(true);
      isCompleteRef.current = true;
      setPhase('complete');
      speak('Test complete. Please remove your headset.');
      broadcastVRState({ isComplete: true, phase: 'complete' });
    }));

    U.push(socketService.on('peer_disconnected', () => {
      if (isCompleteRef.current) return;
      console.log('[PatientScreen] peer_disconnected → showing disconnect overlay');
      setAssistantDisconnected(true);
      setInstruction('Assistant disconnected. Please wait\u2026');
      broadcastVRState({ assistantDisconnected: true });
    }));

    U.push(socketService.on('assistant_disconnected', (data) => {
      if (isCompleteRef.current) return;
      console.log('[PatientScreen] assistant_disconnected', data);
      setAssistantDisconnected(true);
      setInstruction('Assistant disconnected. Please wait\u2026');
      speak('The assistant has disconnected. Please wait for them to reconnect.');
      broadcastVRState({ assistantDisconnected: true });
    }));

    U.push(socketService.on('assistant_joined', async (data) => {
      console.log('[PatientScreen] assistant_joined', data);
      setAssistantDisconnected(false);
      setInstruction('Assistant reconnected. Resuming test\u2026');
      speak('Assistant reconnected. The test will continue.');
      broadcastVRState({ assistantDisconnected: false });
      try {
        webRTCService.disconnect();
        await webRTCService.initAudio('patient', roomCodeRef.current);
      } catch (e) {
        console.warn('[PatientScreen] WebRTC restart after assistant_joined failed', e);
      }
    }));

    U.push(socketService.on('result_ready', (data) => {
      setIsComplete(true);
      console.log('[PatientScreen] result_ready', data);
      const resultId = data?.resultId ?? '';
      if (!resultId) {
        console.warn('[PatientScreen] result_ready — resultId empty, payload:', data);
        return;
      }
      const resultPdfUri = getResultPdfUri(resultId);
      console.log('[PatientScreen] broadcasting resultPdfUri:', resultPdfUri);
      broadcastVRState({ resultReady: true, resultPdfUri, resultId });
    }));
    U.push(socketService.on('call_declined', (data) => {
      console.log('[PatientScreen] call_declined', data);
      const msg = data?.message ?? 'The assistant declined the call.';
      speak(msg);
      if (isVRHost) {
        localPeerService.send('call_declined', {
          roomCode: data?.roomCode ?? roomCodeRef.current,
          patientName: data?.patientName ?? patientName,
          message: msg,
        });
      }

      returnToRegistration(msg);
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER A: VR Host Waiting
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'host_waiting') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={s.regOverlay}>
          <WifiGuard onRestore={handleWifiRestore} />
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 2, color: '#7c7cf0', textTransform: 'uppercase' }}>VR Host Device</Text>
            <Text style={{ fontSize: 22, fontWeight: '300', color: '#e8e8f0' }}>Waiting for Controller</Text>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: peerConnected ? '#4caf50' : '#f9a825', marginTop: 4 }} />
            <Text style={{ color: '#555', fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
              {peerConnected
                ? 'Controller connected. Registration will be done on the controller device.'
                : 'Make sure the controller device connects on the same Wi\u2011Fi.'}
            </Text>
            {peerConnected && <ActivityIndicator color="#5b5bd6" />}
            <TouchableOpacity
              style={s.hostDisconnectBtn}
              onPress={handleSelfDisconnect}
              activeOpacity={0.85}
            >
              <Text style={s.hostDisconnectText}>⏏ Disconnect &amp; Exit</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER B: Registration (standalone / legacy)
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'registration') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={s.regOverlay}>
          <WifiGuard onRestore={handleWifiRestore} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={s.regScroll} keyboardShouldPersistTaps="handled">
              <View style={s.regCard}>
                <View style={s.regHeader}>
                  <View style={s.regLogo}><Text style={{ fontSize: 24 }}>👁</Text></View>
                  <Text style={s.regEyebrow}>Vision Screening</Text>
                  <Text style={s.regTitle}>Patient Registration</Text>
                  <View style={s.regSteps}>
                    <View style={[s.regStep, regStep === 'details' && s.regStepActive, regStep === 'assistant' && s.regStepDone]}>
                      <View style={[s.regStepNum, regStep === 'details' && s.regStepNumActive, regStep === 'assistant' && s.regStepNumDone]}>
                        <Text style={s.regStepNumText}>{regStep === 'assistant' ? '✓' : '1'}</Text>
                      </View>
                      <Text style={[s.regStepLabel, regStep === 'details' && s.regStepLabelActive]}>Your Details</Text>
                    </View>
                    <View style={s.regStepLine} />
                    <View style={[s.regStep, regStep === 'assistant' && s.regStepActive]}>
                      <View style={[s.regStepNum, regStep === 'assistant' && s.regStepNumActive]}>
                        <Text style={s.regStepNumText}>2</Text>
                      </View>
                      <Text style={[s.regStepLabel, regStep === 'assistant' && s.regStepLabelActive]}>Select Assistant</Text>
                    </View>
                  </View>
                </View>

                <View style={s.regBody}>
                  {regStep === 'details' && (
                    <>
                      {/* ── Name Field ───────────────────────────────────────────────────────
                          Rules:
                            • required — cannot be empty
                            • minLength 2 — must have at least 2 characters
                            • validate: trim check — prevents "  " (spaces-only) passing
                      */}
                      <View style={s.regField}>
                        <Text style={s.regLabel}>Full Name <Text style={s.req}>*</Text></Text>
                        <Controller
                          control={control}
                          name="regName"
                          rules={{
                            required: 'Patient name is required',
                            minLength: {
                              value: 2,
                              message: 'Name must be at least 2 characters',
                            },
                            validate: (v) =>
                              v.trim().length >= 2 || 'Name must be at least 2 characters',
                          }}
                          render={({ field: { onChange, onBlur, value } }) => (
                            <TextInput
                              style={[s.regInput, errors.regName && s.regInputError]}
                              value={value}
                              onChangeText={onChange}
                              onBlur={onBlur}
                              placeholder="Patient name"
                              placeholderTextColor="#555"
                              autoCapitalize="words"
                            />
                          )}
                        />
                        {errors.regName && (
                          <Text style={s.errorText}>⚠ {errors.regName.message}</Text>
                        )}
                      </View>

                      <View style={s.regRow}>
                        {/* ── Age Field ──────────────────────────────────────────────────────
                            Rules:
                              • NOT required — patient may be unknown
                              • If filled: digits only, 1–120
                              • validate: conditional — only run range check when non-empty
                                so an empty field passes without showing an error
                        */}
                        <View style={[s.regField, { flex: 1 }]}>
                          <Text style={s.regLabel}>Age</Text>
                          <Controller
                            control={control}
                            name="regAge"
                            rules={{
                              pattern: {
                                value: /^[0-9]*$/,
                                message: 'Numbers only',
                              },
                              validate: (v) => {
                                if (!v || v === '') return true; // optional field
                                const n = Number(v);
                                if (n < 1) return 'Age must be at least 1';
                                if (n > 120) return 'Age cannot exceed 120';
                                return true;
                              },
                            }}
                            render={({ field: { onChange, onBlur, value } }) => (
                              <TextInput
                                style={[s.regInput, errors.regAge && s.regInputError]}
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                placeholder="Age"
                                placeholderTextColor="#555"
                                keyboardType="numeric"
                                maxLength={3}
                              />
                            )}
                          />
                          {errors.regAge && (
                            <Text style={s.errorText}>⚠ {errors.regAge.message}</Text>
                          )}
                        </View>

                        {/* ── Mobile Field ───────────────────────────────────────────────────
                            Rules:
                              • required
                              • maxLength={10} on TextInput — keyboard never allows >10 chars
                              • validate function gives two distinct messages:
                                  – "must be 10 digits" when length < 10 (partial input)
                                  – "digits only" when non-numeric chars sneak in
                                This is clearer than a single pattern error message.
                        */}
                        <View style={[s.regField, { flex: 2 }]}>
                          <Text style={s.regLabel}>Mobile Number <Text style={s.req}>*</Text></Text>
                          <Controller
                            control={control}
                            name="regMobile"
                            rules={{
                              required: 'Mobile number is required',
                              validate: (v) => {
                                if (!/^[0-9]+$/.test(v)) return 'Mobile number must contain digits only';
                                if (v.length < 10) return `Mobile number must be 10 digits (${v.length}/10 entered)`;
                                if (v.length > 10) return 'Mobile number must be exactly 10 digits'; // safety net
                                return true;
                              },
                            }}
                            render={({ field: { onChange, onBlur, value } }) => (
                              <TextInput
                                style={[s.regInput, errors.regMobile && s.regInputError]}
                                value={value}
                                onChangeText={(text) => {
                                  // Strip non-digits client-side before sending to onChange
                                  // so the validate function always receives a clean string
                                  onChange(text.replace(/[^0-9]/g, ''));
                                }}
                                onBlur={onBlur}
                                placeholder="10-digit mobile"
                                placeholderTextColor="#555"
                                keyboardType="phone-pad"
                                maxLength={10}
                              />
                            )}
                          />
                          {errors.regMobile && (
                            <Text style={s.errorText}>⚠ {errors.regMobile.message}</Text>
                          )}
                        </View>
                      </View>

                      {/* ── Gender Field ──────────────────────────────────────────────────── */}
                      <View style={s.regField}>
                        <Text style={s.regLabel}>Gender <Text style={s.req}>*</Text></Text>
                        <Controller
                          control={control}
                          name="regGender"
                          rules={{ required: 'Please select a gender' }}
                          render={({ field: { onChange, value } }) => (
                            <View style={s.regGenderRow}>
                              {['Male', 'Female', 'Other'].map(g => (
                                <TouchableOpacity
                                  key={g}
                                  style={[s.genderBtn, value === g && s.genderBtnSelected]}
                                  onPress={() => onChange(g)}
                                >
                                  <Text style={[s.genderBtnText, value === g && s.genderBtnTextSelected]}>{g}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                        />
                        {errors.regGender && (
                          <Text style={s.errorText}>⚠ {errors.regGender.message}</Text>
                        )}
                      </View>

                      {/* ── Glasses Checkbox ─────────────────────────────────────────────── */}
                      <Controller
                        control={control}
                        name="regGlasses"
                        render={({ field: { onChange, value } }) => (
                          <TouchableOpacity style={s.checkRow} onPress={() => onChange(!value)} activeOpacity={0.7}>
                            <View style={[s.checkbox, value && s.checkboxChecked]}>{value && <Text style={s.checkmark}>✓</Text>}</View>
                            <Text style={s.checkLabel}>Currently wearing glasses / contact lenses</Text>
                          </TouchableOpacity>
                        )}
                      />

                      {/* ── Allergies ────────────────────────────────────────────────────── */}
                      <View style={s.regField}>
                        <Text style={s.regLabel}>Known Allergies</Text>
                        <Controller
                          control={control}
                          name="regAllergies"
                          render={({ field: { onChange, value } }) => (
                            <View style={s.allergyGrid}>
                              {ALLERGY_OPTIONS.map(a => (
                                <TouchableOpacity
                                  key={a.key}
                                  style={[s.allergyChip, value[a.key] && s.allergyChipSelected]}
                                  onPress={() => onChange({ ...value, [a.key]: !value[a.key] })}
                                  activeOpacity={0.7}
                                >
                                  <Text style={[s.allergyChipText, value[a.key] && s.allergyChipTextSelected]}>{a.label}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                        />
                      </View>

                      {/* ── Next Button ───────────────────────────────────────────────────
                          Disabled when isValid is false.
                          With mode:'all', isValid reflects the true validity of the whole
                          form — it is false until Name (required, ≥2 chars), Mobile
                          (required, 10 digits), and Gender (required) all pass.
                          Age is optional so it doesn't block the button unless the user
                          typed an out-of-range value.
                      */}
                      <TouchableOpacity
                        style={[s.regBtn, !isValid && s.regBtnDisabled]}
                        onPress={handleSubmit(onDetailsSubmit)}
                        disabled={!isValid}
                        activeOpacity={0.85}
                      >
                        <Text style={s.regBtnText}>Next — Choose Assistant →</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {regStep === 'assistant' && (
                    <>
                      <TouchableOpacity style={s.regBack} onPress={() => setRegStep('details')}>
                        <Text style={s.regBackText}>← Back</Text>
                      </TouchableOpacity>
                      <Text style={s.regSectionTitle}>Select your assistant</Text>
                      {loadingAssistants ? (
                        <View style={s.loadingRow}><ActivityIndicator color="#5b5bd6" /><Text style={s.loadingText}>Loading available assistants…</Text></View>
                      ) : activeAssistants.length === 0 ? (
                        <View style={s.emptyBox}>
                          <Text style={s.emptyText}>No assistants are currently online.</Text>
                          <TouchableOpacity style={s.retryBtn} onPress={fetchAssistants}><Text style={s.retryBtnText}>Retry</Text></TouchableOpacity>
                        </View>
                      ) : (
                        <View style={s.assistantList}>
                          {activeAssistants.map(a => (
                            <TouchableOpacity key={a.assistantId} style={[s.assistantCard, selectedAssistantId === a.assistantId && s.assistantCardSelected]} onPress={() => setSelectedAssistantId(a.assistantId)} activeOpacity={0.75}>
                              <View style={s.assistantAvatar}><Text style={s.assistantAvatarText}>{(a.name ?? '?').charAt(0).toUpperCase()}</Text></View>
                              <View style={s.assistantInfo}>
                                <Text style={s.assistantName}>{a.name}</Text>
                                <Text style={s.assistantId2}>{a.assistantId}</Text>
                              </View>
                              {selectedAssistantId === a.assistantId && <Text style={s.assistantCheck}>✓</Text>}
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                      {submitError ? (
                        <View style={s.errorBanner}><Text style={s.errorBannerText}>⚠️ {submitError}</Text></View>
                      ) : null}
                      <TouchableOpacity style={[s.regBtn, (!selectedAssistantId || submitting) && s.regBtnDisabled]} onPress={submitRegistration} disabled={!selectedAssistantId || submitting} activeOpacity={0.85}>
                        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.regBtnText}>Start Session</Text>}
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER C: Pre-VR "Begin Test"
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'ready') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={s.overlay}>
          <WifiGuard onRestore={handleWifiRestore} />
          <View style={s.startCard}>
            <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 2, color: '#7c7cf0', textTransform: 'uppercase' }}>Clinical Vision Test</Text>
            <Text style={{ fontSize: 22, fontWeight: '300', color: '#e8e8f0' }}>Vision Screening</Text>
            {patientName ? <Text style={{ color: '#888', fontSize: 13, fontStyle: 'italic' }}>Patient: {patientName}</Text> : null}
            {roomCode ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16, backgroundColor: 'rgba(91,91,214,0.1)', borderWidth: 1, borderColor: 'rgba(91,91,214,0.2)', borderRadius: 100 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', letterSpacing: 1.5, color: '#5b5bd6', textTransform: 'uppercase' }}>ROOM</Text>
                <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontWeight: '700', color: '#c0c0e0', letterSpacing: 1.3 }}>{roomCode}</Text>
              </View>
            ) : null}
            {!isVRHost && (
              <TouchableOpacity style={{ alignSelf: 'flex-start' }} onPress={() => returnToRegistration('')}>
                <Text style={{ color: '#7c7cf0', fontSize: 13 }}>← Back to registration</Text>
              </TouchableOpacity>
            )}
            {isVRHost ? (
              <Text style={{ color: '#555', fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
                Put on the headset. Test will start from the controller.
              </Text>
            ) : (
              <>
                <TouchableOpacity style={[s.regBtn, { width: '100%', marginTop: 12 }]} onPress={enterVR} activeOpacity={0.85}>
                  <Text style={s.regBtnText}>▶ Begin Test</Text>
                </TouchableOpacity>
                <Text style={{ color: '#444', fontSize: 11, marginTop: 4 }}>Put on your headset before tapping</Text>
              </>
            )}
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER D: Active VR — Split-screen cardboard
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <SplitVRLayout
        phase={phase}
        instruction={instruction}
        patientName={patientName}
        optotype={optotype}
        isComplete={isComplete}
        showLeft={showLeft}
        showRight={showRight}
        colorShowLeft={colorShowLeft}
        colorShowRight={colorShowRight}
        nearShowLeft={nearShowLeft}
        nearShowRight={nearShowRight}
        astigShowLeft={astigShowLeft}
        astigShowRight={astigShowRight}
        plateDots={plateDots}
        plateIndex={plateIndex}
        totalPlates={TOTAL_PLATES}
        showFeedback={showFeedback}
        feedbackSeen={feedbackSeen}
        parallax={parallax}
        rtcState={rtcState}
        onCloseSession={handleCloseSession}
        nearOptotype={nearOptotype}
        isLensCheck={isLensCheck}
        lensCheckEye={lensCheckEye}
        assistantDisconnected={assistantDisconnected}
      />
      <TouchableOpacity
        style={{
          position: 'absolute', bottom: 20, right: 20,
          width: 44, height: 44, borderRadius: 22,
          backgroundColor: 'rgba(0,0,0,0.55)',
          alignItems: 'center', justifyContent: 'center',
          zIndex: 200,
        }}
        onPress={() => webRTCService.toggleMute()}
        activeOpacity={0.8}
      >
        <Text style={{ fontSize: 20 }}>{rtcState.isMuted ? '🔇' : '🎙'}</Text>
      </TouchableOpacity>

      {isComplete && (
        <TouchableOpacity
          style={s.vrCompleteDisconnectBtn}
          onPress={handleSelfDisconnect}
          activeOpacity={0.85}
        >
          <Text style={s.vrCompleteDisconnectText}>⏏ Disconnect</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const { width: W } = Dimensions.get('window');

const s = StyleSheet.create({
  regOverlay: { flex: 1, backgroundColor: '#080820' },
  regScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 32, paddingHorizontal: 20 },
  regCard: { width: '100%', maxWidth: 480, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(124,124,240,0.18)', borderRadius: 20, overflow: 'hidden' },
  regHeader: { alignItems: 'center', paddingTop: 32, paddingBottom: 24, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: 'rgba(124,124,240,0.12)', backgroundColor: 'rgba(91,91,214,0.04)', gap: 6 },
  regLogo: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(91,91,214,0.1)', borderWidth: 1, borderColor: 'rgba(124,124,240,0.3)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  regEyebrow: { fontSize: 10, fontWeight: '600', letterSpacing: 2, color: '#7c7cf0', textTransform: 'uppercase' },
  regTitle: { fontSize: 22, fontWeight: '300', color: '#e8e8f0', letterSpacing: 0.4, marginBottom: 16 },
  regSteps: { flexDirection: 'row', alignItems: 'center' },
  regStep: { flexDirection: 'row', alignItems: 'center', gap: 8, opacity: 0.45 },
  regStepActive: { opacity: 1 },
  regStepDone: { opacity: 0.7 },
  regStepLine: { width: 32, height: 1, backgroundColor: 'rgba(124,124,240,0.3)', marginHorizontal: 8 },
  regStepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  regStepNumActive: { backgroundColor: '#5b5bd6', borderColor: '#5b5bd6' },
  regStepNumDone: { backgroundColor: 'rgba(91,91,214,0.35)', borderColor: '#5b5bd6' },
  regStepNumText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  regStepLabel: { color: '#888', fontSize: 11, fontWeight: '500' },
  regStepLabelActive: { color: '#e8e8f0' },
  regBody: { padding: 24, gap: 18 },
  regField: { gap: 8 },
  regLabel: { color: '#aaa', fontSize: 12, fontWeight: '500', letterSpacing: 0.4 },
  req: { color: '#7c7cf0' },
  regInput: { backgroundColor: '#0d0d1a', borderWidth: 1, borderColor: '#2a2a40', borderRadius: 10, color: '#e8e8f0', fontSize: 14, paddingVertical: 12, paddingHorizontal: 14 },
  regInputError: { borderColor: '#ef5350' },
  errorText: { color: '#ef5350', fontSize: 11, marginTop: -4 },
  regRow: { flexDirection: 'row', gap: 12 },
  regGenderRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  genderBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a40', backgroundColor: '#0d0d1a' },
  genderBtnSelected: { borderColor: '#5b5bd6', backgroundColor: 'rgba(91,91,214,0.15)' },
  genderBtnText: { color: '#666', fontSize: 12 },
  genderBtnTextSelected: { color: '#a0a0f0', fontWeight: '600' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#3a3a5a', backgroundColor: '#0d0d1a', alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: '#5b5bd6', borderColor: '#5b5bd6' },
  checkmark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  checkLabel: { flex: 1, color: '#aaa', fontSize: 13, lineHeight: 18 },
  allergyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  allergyChip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 100, borderWidth: 1, borderColor: '#2a2a40', backgroundColor: '#0d0d1a' },
  allergyChipSelected: { borderColor: '#5b5bd6', backgroundColor: 'rgba(91,91,214,0.15)' },
  allergyChipText: { color: '#555', fontSize: 12 },
  allergyChipTextSelected: { color: '#a0a0f0', fontWeight: '600' },
  regBtn: { backgroundColor: '#5b5bd6', paddingVertical: 14, borderRadius: 100, alignItems: 'center', marginTop: 4, shadowColor: '#5b5bd6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6 },
  regBtnDisabled: { opacity: 0.35, shadowOpacity: 0 },
  regBtnText: { color: '#fff', fontSize: 14, fontWeight: '600', letterSpacing: 0.4 },
  regBack: { alignSelf: 'flex-start' },
  regBackText: { color: '#7c7cf0', fontSize: 13 },
  regSectionTitle: { color: '#c0c0e0', fontSize: 14, fontWeight: '600', marginBottom: 4 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 20, justifyContent: 'center' },
  loadingText: { color: '#666', fontSize: 13 },
  emptyBox: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  emptyText: { color: '#666', fontSize: 13 },
  retryBtn: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 100, borderWidth: 1, borderColor: '#5b5bd6' },
  retryBtnText: { color: '#7c7cf0', fontSize: 13 },
  assistantList: { gap: 10 },
  assistantCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#1e1e30', backgroundColor: '#0d0d1a' },
  assistantCardSelected: { borderColor: '#5b5bd6', backgroundColor: 'rgba(91,91,214,0.08)' },
  assistantAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(91,91,214,0.2)', alignItems: 'center', justifyContent: 'center' },
  assistantAvatarText: { color: '#a0a0f0', fontSize: 18, fontWeight: '700' },
  assistantInfo: { flex: 1, gap: 3 },
  assistantName: { color: '#e0e0f0', fontSize: 14, fontWeight: '600' },
  assistantId2: { color: '#555', fontSize: 11 },
  assistantCheck: { color: '#5b5bd6', fontSize: 18, fontWeight: '700' },
  errorBanner: { backgroundColor: 'rgba(204,51,51,0.1)', borderWidth: 1, borderColor: 'rgba(204,51,51,0.3)', borderRadius: 10, padding: 12 },
  errorBannerText: { color: '#ff6666', fontSize: 12, lineHeight: 18 },
  overlay: { flex: 1, backgroundColor: '#080820', alignItems: 'center', justifyContent: 'center' },
  startCard: { alignItems: 'center', gap: 18, paddingTop: 44, paddingBottom: 36, paddingHorizontal: 40, backgroundColor: 'rgba(255,255,255,0.025)', borderWidth: 1, borderColor: 'rgba(124,124,240,0.22)', borderRadius: 20, width: Math.min(360, W * 0.88), shadowColor: '#5b5bd6', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 24, elevation: 10 },

  hostDisconnectBtn: {
    marginTop: 12, paddingVertical: 9, paddingHorizontal: 24,
    borderRadius: 100, borderWidth: 1,
    borderColor: 'rgba(229,57,53,0.35)',
    backgroundColor: 'rgba(229,57,53,0.07)',
  },
  hostDisconnectText: { color: '#ef5350', fontSize: 13, fontWeight: '500' },

  vrCompleteDisconnectBtn: {
    position: 'absolute', bottom: 76, right: 16,
    paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 100, borderWidth: 1,
    borderColor: 'rgba(229,57,53,0.45)',
    backgroundColor: 'rgba(0,0,0,0.65)',
    zIndex: 201,
  },
  vrCompleteDisconnectText: { color: '#ef9a9a', fontSize: 12, fontWeight: '600' },
});