/**
 * ControllerScreen.js v4.1 — Assistant Reconnect with Selector + Countdown
 *
 * Changes from v4.0:
 * - REPLACE: AssistantDisconnectedModal now mirrors Angular patient_component:
 *     • 90-second countdown timer (RECONNECT_GRACE_SECONDS)
 *     • Polls active assistants every 5 s while modal is open
 *     • Assistant selector list (same card style as registration step 2)
 *     • Reassign button calls POST /api/vr/session/:roomCode/reassign
 *     • Modal auto-closes when PatientScreen broadcasts assistantDisconnected=false
 *       (i.e. server fires assistant_joined back to the patient)
 * - ADD: reassignAssistantApi helper
 * - ADD: reconnect-specific state: reconnectAssistants, selectedReassignId,
 *        loadingReconnectAssistants, reassigning, reassignError,
 *        reconnectTimeLeft, reconnectPollRef, reconnectCountdownRef
 * - KEEP: all existing views (connecting/registration/ready/monitoring/result)
 *         and their styles completely unchanged
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, StatusBar, ActivityIndicator,
  KeyboardAvoidingView, Platform, Dimensions, Modal, Animated,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Pdf from 'react-native-pdf';

import localPeerService from '../services/localPeerService';
import WifiGuard from '../components/WifiGuard';
import { useWifiGuard } from '../hooks/useWifiGuard';
import EyePanel from '../components/EyePanel';
import { generatePlateDots, getPlate, TOTAL_PLATES } from '../utils/ishiharaPanel';
import apiService from '../../api/AxiosClient';
import { fetchActiveAssistantsApi, reassignAssistantApi, submitRegistrationApi } from '../../api/ApiService';
import { useDispatch } from 'react-redux';
import { fetchResultData } from '../../store/slices/resultSlice';
import VisionResultView from '../components/VisionResultView';
import { LANGUAGE_OPTIONS } from '../../assets/constants';
// import apiService from '../../api/AxiosClient'



const ALLERGY_OPTIONS = [
  { key: 'allergyNITT', label: 'NITT' },
  { key: 'allergyPenicillin', label: 'Penicillin' },
  { key: 'allergyXylocaine', label: 'Xylocaine' },
  { key: 'allergySulpha', label: 'Sulpha' },
  { key: 'allergyAtropine', label: 'Atropine' },
  { key: 'allergyDropsyn', label: 'Dropsyn' },
];
const INIT_ALLERGIES = {
  allergyNITT: false, allergyPenicillin: false, allergyXylocaine: false,
  allergySulpha: false, allergyAtropine: false, allergyDropsyn: false,
};

const PHASE_COLORS = {
  waiting: '#444', acuity: '#5b5bd6', color: '#e91e63',
  near: '#009688', astigmatism: '#ff9800', complete: '#4caf50',
};


// v4.1: matches Angular RECONNECT_GRACE_SECONDS
const RECONNECT_GRACE_SECONDS = 90;

const { width: W } = Dimensions.get('window');
const EYE_W = Math.floor((W - 38) / 2);
const EYE_H = Math.round(EYE_W * (4 / 3));

// ─────────────────────────────────────────────────────────────────────────────
// AssistantDisconnectedModal  v4.1
// Full mirror of Angular patient_component reconnect modal:
//   • 90-second countdown (RECONNECT_GRACE_SECONDS)
//   • Polls active-assistants every 5 s
//   • Assistant selector — same card style as registration step 2
//   • Reassign CTA calls POST /api/vr/session/:roomCode/reassign
// Props:
//   visible, roomCode, patientName, onReassignSuccess, onClose
// ─────────────────────────────────────────────────────────────────────────────
function AssistantDisconnectedModal({ visible, roomCode, patientName, onReassignSuccess }) {
  const pulse = useRef(new Animated.Value(1)).current;

  // ── Countdown ──────────────────────────────────────────────────────────────
  const [timeLeft, setTimeLeft] = useState(RECONNECT_GRACE_SECONDS);
  const countdownRef = useRef(null);

  // ── Assistant list ─────────────────────────────────────────────────────────
  const [assistants, setAssistants] = useState([]);
  const [loadingAssistants, setLoadingAssistants] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const pollRef = useRef(null);

  // ── Reassign state ─────────────────────────────────────────────────────────
  const [reassigning, setReassigning] = useState(false);
  const [reassignError, setReassignError] = useState('');

  // ── Pulsing icon animation ─────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    const p = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    p.start();
    return () => p.stop();
  }, [visible]);

  // ── Open / close lifecycle ─────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) {
      // Clear everything when modal closes
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setTimeLeft(RECONNECT_GRACE_SECONDS);
      setSelectedId('');
      setReassignError('');
      setReassigning(false);
      return;
    }

    // Start countdown
    setTimeLeft(RECONNECT_GRACE_SECONDS);
    countdownRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { clearInterval(countdownRef.current); countdownRef.current = null; return 0; }
        return t - 1;
      });
    }, 1000);

    // Fetch assistants immediately, then poll every 5 s
    fetchAssistants();
    pollRef.current = setInterval(fetchAssistants, 5000);

    return () => {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [visible]); // eslint-disable-line

  async function fetchAssistants() {
    setLoadingAssistants(true);
    try {
      const list = await fetchActiveAssistantsApi();
      setAssistants(Array.isArray(list) ? list : []);
    } catch { setAssistants([]); }
    finally { setLoadingAssistants(false); }
  }

  async function handleReassign() {
    if (!selectedId || reassigning || !roomCode) return;
    const chosen = assistants.find((a) => a.assistantId === selectedId);
    if (chosen?.busy) {
      setReassignError('This assistant is currently busy. Please select another.');
      return;
    }
    setReassigning(true);
    setReassignError('');
    try {
      await reassignAssistantApi(roomCode, selectedId);
      // Modal stays open — it closes when PatientScreen broadcasts
      // assistantDisconnected=false (i.e. server fires assistant_joined)
      onReassignSuccess?.();
    } catch (err) {
      setReassigning(false);
      setReassignError(
        err?.response?.data?.message ?? err?.message ?? 'Could not reassign. Please try again.'
      );
    }
  }

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={dm.backdrop}>
        <View style={dm.card}>

          {/* Pulsing warning icon */}
          <Animated.View style={[dm.iconRing, { opacity: pulse }]}>
            <Text style={dm.iconText}>⚠</Text>
          </Animated.View>

          <Text style={dm.title}>Assistant Disconnected</Text>
          <Text style={dm.sub}>
            The assistant has lost connection.{'\n'}
            Select an available assistant to continue the session.
          </Text>

          {/* Countdown badge — mirrors Angular reconnectTimeLeft display */}
          {timeLeft > 0 && (
            <View style={dm.countdownBadge}>
              <Text style={dm.countdownLabel}>WAITING</Text>
              <Text style={dm.countdownValue}>{timeLeft}s</Text>
            </View>
          )}

          {/* ── Assistant selector ─────────────────────────────────────── */}
          <View style={dm.listWrapper}>
            {loadingAssistants && assistants.length === 0 ? (
              <View style={dm.loadingRow}>
                <ActivityIndicator color="#f9a825" size="small" />
                <Text style={dm.loadingText}>Loading available assistants…</Text>
              </View>
            ) : assistants.length === 0 ? (
              <View style={dm.emptyRow}>
                <Text style={dm.emptyText}>No assistants are currently online.</Text>
                <TouchableOpacity style={dm.refreshBtn} onPress={fetchAssistants}>
                  <Text style={dm.refreshBtnText}>↺ Refresh</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: 200 }}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
              >
                <View style={{ gap: 8 }}>
                  {assistants.map((a) => {
                    const isBusy = a.busy === true;
                    const isSel = selectedId === a.assistantId;
                    return (
                      <TouchableOpacity
                        key={a.assistantId}
                        style={[
                          dm.assistantCard,
                          isSel && !isBusy && dm.assistantCardSel,
                          isBusy && dm.assistantCardBusy,
                        ]}
                        onPress={() => { if (!isBusy) setSelectedId(a.assistantId); }}
                        disabled={isBusy}
                        activeOpacity={isBusy ? 1 : 0.75}
                      >
                        <View style={dm.avatar}>
                          <Text style={dm.avatarText}>{(a.name ?? '?')[0].toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={dm.assistantName}>{a.name}</Text>
                          <Text style={dm.assistantSub}>{a.assistantId}</Text>
                          {isBusy && <Text style={dm.busyLabel}>Busy</Text>}
                        </View>
                        {!isBusy && isSel && <Text style={dm.checkMark}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            )}
          </View>

          {/* Error */}
          {reassignError ? (
            <View style={dm.errorBox}>
              <Text style={dm.errorText}>⚠ {reassignError}</Text>
            </View>
          ) : null}

          {/* Reassign CTA */}
          <TouchableOpacity
            style={[dm.reassignBtn, (!selectedId || reassigning) && dm.reassignBtnOff]}
            onPress={handleReassign}
            disabled={!selectedId || reassigning}
            activeOpacity={0.85}
          >
            {reassigning
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={dm.reassignBtnText}>↺  Connect to Selected Assistant</Text>
            }
          </TouchableOpacity>

          {/* Patient info footer */}
          {patientName ? (
            <Text style={dm.patientFooter}>Patient: {patientName} · Room {roomCode}</Text>
          ) : null}

        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main ControllerScreen
// ─────────────────────────────────────────────────────────────────────────────
export default function ControllerScreen({ route, navigation }) {
  // view: 'connecting' | 'registration' | 'ready' | 'monitoring' | 'result'
  const [view, setView] = useState(
    localPeerService.isConnected() ? 'registration' : 'connecting'
  );

  // ── Peer status ─────────────────────────────────────────────────────────
  const [peerConnected, setPeerConnected] = useState(localPeerService.isConnected());
  const [peerRtt, setPeerRtt] = useState(null);
  const [peerReconnecting, setPeerReconnecting] = useState(false);
  const [reconnectFailed, setReconnectFailed] = useState(false);

  // ── Registration ────────────────────────────────────────────────────────
  const [regStep, setRegStep] = useState('details');
  const [regName, setRegName] = useState('');
  const [regAge, setRegAge] = useState('');
  const [regGender, setRegGender] = useState('');
  const [regMobile, setRegMobile] = useState('');
  const [regGlasses, setRegGlasses] = useState(false);
  const [regAllergies, setRegAllergies] = useState({ ...INIT_ALLERGIES });
  const [regLanguage, setRegLanguage] = useState('en');
  const [activeAssistants, setActiveAssistants] = useState([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState('');
  const [loadingAssistants, setLoadingAssistants] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const dispatch = useDispatch();
  // ── Session ─────────────────────────────────────────────────────────────
  const [roomCode, setRoomCode] = useState('');
  const [patientName, setPatientName] = useState('');
  const [vrState, setVrState] = useState({
    phase: 'waiting', instruction: 'Waiting…', optotype: null,
    isComplete: false,
    showLeft: true, showRight: true,
    colorShowLeft: true, colorShowRight: true,
    nearShowLeft: true, nearShowRight: true,
    astigShowLeft: true, astigShowRight: true,
    plateIndex: 0, nearOptotype: null,
    isLensCheck: false, lensCheckEye: 'both',
  });

  // ── v4.0 / v4.1 state ───────────────────────────────────────────────────
  const [assistantDisconnected, setAssistantDisconnected] = useState(false);
  const [resultReady, setResultReady] = useState(false);
  const [resultPdfUri, setResultPdfUri] = useState('');
  const [pdfError, setPdfError] = useState(null);

  const unsubs = useRef([]);

  // ── Wi-Fi guard ──────────────────────────────────────────────────────────
  useWifiGuard();
  const handleWifiRestore = useCallback(() => {
    if (!localPeerService.isConnected()) localPeerService.manualReconnect();
  }, []);

  // ── Mount: peer listeners ────────────────────────────────────────────────
  useEffect(() => {
    const U = unsubs.current;

    U.push(localPeerService.on('connected', () => {
      setPeerConnected(true);
      setPeerReconnecting(false);
      setReconnectFailed(false);
      setView((prev) => prev === 'connecting' ? 'registration' : prev);
    }));

    U.push(localPeerService.on('disconnected', () => setPeerConnected(false)));

    U.push(localPeerService.on('reconnecting', () => {
      setPeerReconnecting(true);
      setPeerConnected(false);
      setReconnectFailed(false);
    }));

    U.push(localPeerService.on('reconnectfailed', () => {
      setReconnectFailed(true);
      setPeerReconnecting(false);
      setPeerConnected(false);
    }));

    U.push(localPeerService.on('pingrtt', ({ rtt }) => setPeerRtt(rtt)));

    // ── vr_state_update — handles ALL patient-side broadcasts ─────────────
    U.push(localPeerService.on('vr_state_update', (state) => {
      console.log("vr_state_update::", state)
      setVrState((prev) => ({ ...prev, ...state }));

      // Phase change → switch to monitoring if in ready
      if (state.phase && state.phase !== 'waiting') {
        setView((prev) => prev === 'ready' ? 'monitoring' : prev);
      }

      // v4.1: assistant disconnected → show modal (selector + countdown inside modal)
      if (state.assistantDisconnected === true) {
        setAssistantDisconnected(true);
      }

      // v4.1: assistant reconnected → close modal, continue test
      if (state.assistantDisconnected === false) {
        setAssistantDisconnected(false);
      }

      // v4.0: result ready → switch to PDF result view
      if (state.resultReady === true) {
        const uri = state.resultPdfUri ?? '';
        setResultPdfUri(uri);
        setResultReady(true);
        setPdfError(null);
        setView('result');
        const resultId = state.resultId;
        if (resultId) {
          dispatch(fetchResultData(resultId));
        }
      }
    }));

    U.push(localPeerService.on('vr_session_started', ({ patientName: pn }) => {
      if (pn) setPatientName(pn);
      setView('monitoring');
    }));

    U.push(localPeerService.on('vr_session_ended', () => resetSession()));

    if (localPeerService.isConnected()) setPeerConnected(true);
    fetchAssistants();

    return () => { U.forEach((fn) => fn()); };
  }, []); // eslint-disable-line

  // ── Helpers ──────────────────────────────────────────────────────────────
  const resetSession = useCallback(() => {
    setView('registration');
    setRoomCode('');
    setRegStep('details');
    setSelectedAssistantId('');
    setSubmitError('');
    setPatientName('');
    setVrState({
      phase: 'waiting', instruction: 'Waiting…', optotype: null,
      isComplete: false,
      showLeft: true, showRight: true,
      colorShowLeft: true, colorShowRight: true,
      nearShowLeft: true, nearShowRight: true,
      astigShowLeft: true, astigShowRight: true,
      plateIndex: 0, nearOptotype: null,
      isLensCheck: false, lensCheckEye: 'both',
    });
    // v4.1 reset
    setAssistantDisconnected(false);
    setResultReady(false);
    setResultPdfUri('');
    setPdfError(null);
  }, []);

  const fetchAssistants = useCallback(async () => {
    setLoadingAssistants(true);
    try {
      const list = await fetchActiveAssistantsApi();
      setActiveAssistants(Array.isArray(list) ? list : []);
    } catch { setActiveAssistants([]); }
    finally { setLoadingAssistants(false); }
  }, []);

  const regDetailsValid = regName.trim() && regMobile.trim() && regGender;

  const goToAssistantStep = useCallback(() => {
    if (regDetailsValid) { setRegStep('assistant'); fetchAssistants(); }
  }, [regDetailsValid, fetchAssistants]);

  const submitRegistration = useCallback(async () => {
    if (!selectedAssistantId || submitting) return;
    setSubmitting(true); setSubmitError('');
    const payload = {
      patientName: regName.trim(), patientAge: regAge ? Number(regAge) : null,
      patientGender: regGender, mobileNumber: regMobile.trim(), language: regLanguage,
      wearingGlasses: regGlasses, assistantId: selectedAssistantId, ...regAllergies,
    };
    try {
      const res = await submitRegistrationApi(payload);
      const rc = res.roomCode;
      const pn = res.patientName ?? regName.trim();
      setRoomCode(rc);
      setPatientName(pn);
      localPeerService.send('session_registered', { roomCode: rc, patientName: pn });
      setView('ready');
    } catch (err) {
      setSubmitError(err?.response?.data?.message ?? err?.message ?? 'Could not start session.');
    } finally { setSubmitting(false); }
  }, [selectedAssistantId, submitting, regName, regAge, regGender, regMobile, regGlasses, regAllergies]);

  const startTest = useCallback(() => {
    localPeerService.send('start_test', { roomCode });
    setView('monitoring');
  }, [roomCode]);

  const endSession = useCallback(() => {
    localPeerService.send('end_session', { roomCode });
    resetSession();
  }, [roomCode, resetSession]);

  const handleManualReconnect = useCallback(() => {
    setReconnectFailed(false);
    setPeerReconnecting(true);
    localPeerService.manualReconnect();
  }, []);

  // v4.1: Called when modal's reassign API call succeeds
  // Modal closes automatically when PatientScreen broadcasts assistantDisconnected=false
  const handleReassignSuccess = useCallback(() => {
    console.log('[ControllerScreen] Reassign request sent — waiting for assistant_joined');
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER A: Connecting / Reconnecting
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'connecting') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.root}>
          <WifiGuard onRestore={handleWifiRestore} />
          <StatusBar barStyle="light-content" backgroundColor="#080820" />
          <View style={styles.centeredCard}>
            {reconnectFailed ? (
              <>
                <Text style={styles.connectingTitle}>Connection Lost</Text>
                <Text style={styles.connectingHint}>
                  Could not reconnect to the VR host after multiple attempts.{'\n'}
                  Make sure both devices are on the same Wi‑Fi network.
                </Text>
                <TouchableOpacity style={styles.btn} onPress={handleManualReconnect} activeOpacity={0.85}>
                  <Text style={styles.btnText}>↺ Retry Connection</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.ghostBtn}
                  onPress={() => { localPeerService.destroy(); navigation.replace('RoleAndConnectScreen'); }}
                >
                  <Text style={styles.ghostBtnText}>← Back to Connection Screen</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <ActivityIndicator color="#5b5bd6" size="large" />
                <Text style={styles.connectingTitle}>
                  {peerReconnecting ? 'Reconnecting to VR Host…' : 'Waiting for VR Host…'}
                </Text>
                <Text style={styles.connectingHint}>
                  Make sure the VR host device is running and on the same Wi‑Fi.
                </Text>
                {peerReconnecting && (
                  <Text style={styles.reconnectingNote}>Retrying automatically with back-off…</Text>
                )}
              </>
            )}
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER B: Registration
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'registration') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.root}>
          <WifiGuard onRestore={handleWifiRestore} />
          <PeerStatusBar
            connected={peerConnected} rtt={peerRtt}
            reconnecting={peerReconnecting} reconnectFailed={reconnectFailed}
            onRetry={handleManualReconnect}
          />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
              <View style={styles.card}>
                {/* Card header */}
                <View style={styles.cardHeader}>
                  <Text style={styles.cardEyebrow}>Controller · Patient Registration</Text>
                  <Text style={styles.cardTitle}>Patient Registration</Text>
                  {/* Step dots */}
                  <View style={styles.stepIndicator}>
                    <StepDot n={1} active={regStep === 'details'} done={regStep === 'assistant'} label="Details" />
                    <View style={styles.stepLine} />
                    <StepDot n={2} active={regStep === 'assistant'} done={false} label="Assistant" />
                  </View>
                </View>

                <View style={styles.formBody}>
                  {/* ── Step 1: Details ── */}
                  {regStep === 'details' && (
                    <>
                      <View style={styles.row}>
                        <Field label="Full Name *" value={regName} onChange={setRegName} placeholder="Patient name" flex={2} />
                        <Field label="Age" value={regAge} onChange={setRegAge} placeholder="Age" keyboardType="numeric" maxLength={3} flex={1} />
                      </View>
                      <Field label="Mobile Number *" value={regMobile} onChange={setRegMobile} placeholder="Mobile" keyboardType="phone-pad" maxLength={15} />
                      <View style={styles.field}>
                        <Text style={styles.label}>Gender</Text>
                        <View style={styles.genderRow}>
                          {['Male', 'Female', 'Other'].map((g) => (
                            <TouchableOpacity key={g} style={[styles.genderBtn, regGender === g && sv.genderBtnSel]} onPress={() => setRegGender(g)}>
                              <Text style={[styles.genderText, regGender === g && sv.genderTextSel]}>{g}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                      <View style={styles.field}>
                        <Text style={styles.label}>Preferred Language</Text>
                        <View style={styles.genderRow}>
                          {LANGUAGE_OPTIONS.map((lang) => (
                            <TouchableOpacity
                              key={lang.value}
                              style={[styles.genderBtn, regLanguage === lang.value && sv.genderBtnSel]}
                              onPress={() => setRegLanguage(lang.value)}
                            >
                              <Text style={[styles.genderText, regLanguage === lang.value && sv.genderTextSel]}>
                                {lang.label}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                      <TouchableOpacity style={styles.checkRow} onPress={() => setRegGlasses(v => !v)} activeOpacity={0.7}>
                        <View style={[styles.checkbox, regGlasses && sv.checkboxOn]}>
                          {regGlasses && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <Text style={styles.checkLabel}>Currently wearing glasses / contact lenses</Text>
                      </TouchableOpacity>
                      <View style={styles.field}>
                        <Text style={styles.label}>Known Allergies</Text>
                        <View style={styles.allergyGrid}>
                          {ALLERGY_OPTIONS.map((a) => (
                            <TouchableOpacity key={a.key} style={[styles.chip, regAllergies[a.key] && sv.chipSel]} onPress={() => setRegAllergies((p) => ({ ...p, [a.key]: !p[a.key] }))}>
                              <Text style={[styles.chipText, regAllergies[a.key] && sv.chipTextSel]}>{a.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                      <TouchableOpacity
                        style={[styles.btn, !regDetailsValid && sv.btnOff]}
                        onPress={goToAssistantStep}
                        disabled={!regDetailsValid}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.btnText}>Next — Choose Assistant →</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {/* ── Step 2: Assistant ── */}
                  {regStep === 'assistant' && (
                    <>
                      <TouchableOpacity style={styles.back} onPress={() => setRegStep('details')}>
                        <Text style={styles.backText}>← Back</Text>
                      </TouchableOpacity>
                      <Text style={styles.sectionHeading}>Select Assistant</Text>
                      {loadingAssistants ? (
                        <View style={styles.loadingRow}>
                          <ActivityIndicator color="#5b5bd6" />
                          <Text style={styles.loadingText}>Loading…</Text>
                        </View>
                      ) : activeAssistants.length === 0 ? (
                        <View style={styles.emptyBox}>
                          <Text style={styles.emptyText}>No assistants online.</Text>
                          <TouchableOpacity style={styles.retryBtn} onPress={fetchAssistants}>
                            <Text style={styles.retryText}>Retry</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={{ gap: 8 }}>
                          {activeAssistants.map((a) => {
                            const isBusy = a.busy === true;
                            const isSelected = selectedAssistantId === a.assistantId;
                            return (
                              <TouchableOpacity
                                key={a.assistantId}
                                style={[styles.assistantCard, isSelected && sv.assistantCardSel, isBusy && sv.assistantCardBusy]}
                                onPress={() => { if (!isBusy) setSelectedAssistantId(a.assistantId); }}
                                disabled={isBusy}
                                activeOpacity={isBusy ? 1 : 0.75}
                              >
                                <View style={styles.avatar}>
                                  <Text style={styles.avatarText}>{(a.name ?? '?')[0].toUpperCase()}</Text>
                                </View>
                                <View style={{ flex: 1, gap: 3 }}>
                                  <Text style={styles.assistantName}>{a.name}</Text>
                                  {isBusy && <Text style={{ color: '#f9a825', fontSize: 11 }}>Busy</Text>}
                                </View>
                                {!isBusy && isSelected && <Text style={styles.checkIcon}>✓</Text>}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                      {submitError ? (
                        <View style={styles.errorBox}>
                          <Text style={styles.errorText}>⚠ {submitError}</Text>
                        </View>
                      ) : null}
                      <TouchableOpacity
                        style={[styles.btn, (!selectedAssistantId || submitting) && sv.btnOff]}
                        onPress={submitRegistration}
                        disabled={!selectedAssistantId || submitting}
                        activeOpacity={0.85}
                      >
                        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Start Session</Text>}
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
  // RENDER C: Ready
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'ready') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[styles.root, { alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32 }]}>
          <WifiGuard onRestore={handleWifiRestore} />
          <PeerStatusBar
            connected={peerConnected} rtt={peerRtt}
            reconnecting={peerReconnecting} reconnectFailed={reconnectFailed}
            onRetry={handleManualReconnect}
          />
          <Text style={styles.readyTitle}>Session Ready</Text>
          {patientName ? <Text style={styles.readyPatient}>Patient: {patientName}</Text> : null}
          <View style={styles.roomBadge}>
            <Text style={styles.roomLabel}>ROOM</Text>
            <Text style={styles.roomCodeText}>{roomCode}</Text>
          </View>
          <Text style={styles.readyHint}>
            Ask the patient to put on the VR headset, then press Begin Test.
          </Text>
          <TouchableOpacity style={styles.bigBtn} onPress={startTest} activeOpacity={0.85}>
            <Text style={styles.bigBtnText}>▶ Begin Test on VR Device</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ghostBtn} onPress={() => setView('registration')}>
            <Text style={styles.ghostBtnText}>← Back to Registration</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER E: Result PDF (v4.0 NEW)
  // Shown when server fires result_ready — displays the vision report PDF.
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'result') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.root}>
          <WifiGuard onRestore={handleWifiRestore} />
          <PeerStatusBar
            connected={peerConnected} rtt={peerRtt}
            reconnecting={peerReconnecting} reconnectFailed={reconnectFailed}
            onRetry={handleManualReconnect}
          />

          <VisionResultView
            patientName={patientName}
            roomCode={roomCode}
            resultPdfUri={resultPdfUri}
            onEndSession={endSession}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER D: Monitoring
  // ═══════════════════════════════════════════════════════════════════════════
  const {
    phase, instruction, optotype, nearOptotype,
    showLeft, showRight, colorShowLeft, colorShowRight,
    nearShowLeft, nearShowRight, astigShowLeft, astigShowRight,
    plateIndex, isLensCheck, lensCheckEye, isComplete,
  } = vrState;

  let leftActive, rightActive;
  if (phase === 'color') { leftActive = colorShowLeft; rightActive = colorShowRight; }
  else if (phase === 'near') { leftActive = nearShowLeft; rightActive = nearShowRight; }
  else if (phase === 'astigmatism') { leftActive = astigShowLeft; rightActive = astigShowRight; }
  else { leftActive = showLeft; rightActive = showRight; }

  const plateDots = phase === 'color' ? generatePlateDots(getPlate(plateIndex) ?? 0) : [];

  const eyePanelProps = {
    panelWidth: EYE_W, panelHeight: EYE_H,
    phase, instruction, patientName, optotype, plateDots, plateIndex,
    totalPlates: TOTAL_PLATES, showFeedback: false, feedbackSeen: false,
    parallax: 0, nearOptotype, isLensCheck, lensCheckEye, contentTranslateX: 0,
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <WifiGuard onRestore={handleWifiRestore} />
        <PeerStatusBar
          connected={peerConnected} rtt={peerRtt}
          reconnecting={peerReconnecting} reconnectFailed={reconnectFailed}
          onRetry={handleManualReconnect}
        />

        <ScrollView contentContainerStyle={styles.monitorScroll}>
          {/* Header */}
          <View style={styles.monitorHeader}>
            <View>
              <Text style={styles.monitorLabel}>Patient</Text>
              <Text style={styles.monitorValue}>{patientName}</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.monitorLabel}>Room</Text>
              <Text style={styles.monitorValue}>{roomCode}</Text>
            </View>
            <View style={[styles.phasePill, { backgroundColor: PHASE_COLORS[phase] ?? '#444' }]}>
              <Text style={styles.phaseText}>{phase.toUpperCase()}</Text>
            </View>
          </View>

          {/* Instruction */}
          <View style={styles.instructionBox}>
            <Text style={styles.instructionLabel}>VR Instruction</Text>
            <Text style={styles.instructionText}>{instruction}</Text>
          </View>

          {/* Eye panel preview */}
          <View style={styles.eyePreviewRow}>
            {/* LEFT */}
            <View style={styles.eyePreviewCard}>
              <Text style={styles.eyePreviewLabel}>L</Text>
              <View style={[styles.eyePanelWrapper, !leftActive && { opacity: 0.35 }]}>
                <EyePanel {...eyePanelProps} side="left" active={leftActive} />
              </View>
            </View>

            <View style={styles.eyeCentreDivider} />

            {/* RIGHT */}
            <View style={styles.eyePreviewCard}>
              <Text style={styles.eyePreviewLabel}>R</Text>
              <View style={[styles.eyePanelWrapper, !rightActive && { opacity: 0.35 }]}>
                <EyePanel {...eyePanelProps} side="right" active={rightActive} />
              </View>
            </View>
          </View>

          {/* Phase details */}
          {phase === 'acuity' && optotype && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Letter</Text>
              <Text style={styles.infoVal}>{optotype.letter}</Text>
              {optotype.rotation != null && (
                <><Text style={styles.infoLabel}>Rotation</Text><Text style={styles.infoVal}>{optotype.rotation}°</Text></>
              )}
              <Text style={styles.infoLabel}>Acuity</Text>
              <Text style={styles.infoVal}>{optotype.acuityLabel}</Text>
            </View>
          )}
          {phase === 'near' && nearOptotype && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Near letter</Text>
              <Text style={styles.infoVal}>{nearOptotype.letter}</Text>
              {nearOptotype.acuityLabel && (
                <><Text style={styles.infoLabel}>Acuity</Text><Text style={styles.infoVal}>{nearOptotype.acuityLabel}</Text></>
              )}
            </View>
          )}
          {phase === 'color' && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Ishihara Plate</Text>
              <Text style={styles.infoVal}>{(plateIndex ?? 0) + 1}/{TOTAL_PLATES}</Text>
            </View>
          )}
          {phase === 'astigmatism' && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Phase</Text>
              <Text style={styles.infoVal}>Astigmatism clock chart</Text>
            </View>
          )}

          {/* Complete banner */}
          {isComplete && (
            <View style={styles.completeBox}>
              <Text style={styles.completeText}>✅ Test Complete</Text>
            </View>
          )}

          {/* End session */}
          <TouchableOpacity style={[styles.btn, sv.endBtn]} onPress={endSession} activeOpacity={0.85}>
            <Text style={styles.btnText}>End Session</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* ── v4.1: Assistant disconnected modal — with selector + countdown ── */}
        <AssistantDisconnectedModal
          visible={assistantDisconnected}
          roomCode={roomCode}
          patientName={patientName}
          onReassignSuccess={handleReassignSuccess}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────
function PeerStatusBar({ connected, rtt, reconnecting, reconnectFailed, onRetry }) {
  const color = connected ? '#4caf50'
    : reconnectFailed ? '#e53935'
      : reconnecting ? '#f9a825'
        : '#e53935';

  const label = connected
    ? `⬤ Local peer connected${rtt != null ? ` · ${rtt}ms RTT` : ''}`
    : reconnectFailed ? '⬤ Connection lost — tap to retry'
      : reconnecting ? '⬤ Reconnecting to VR host…'
        : '⬤ VR host disconnected';

  return (
    <TouchableOpacity
      style={ps.bar}
      onPress={reconnectFailed ? onRetry : undefined}
      activeOpacity={reconnectFailed ? 0.7 : 1}
      disabled={!reconnectFailed}
    >
      <Text style={[ps.text, { color }]}>{label}</Text>
      {reconnectFailed && <Text style={ps.retryHint}>↺ Retry</Text>}
    </TouchableOpacity>
  );
}

function StepDot({ n, active, done, label }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: active ? 1 : done ? 0.7 : 0.4 }}>
      <View style={[styles.stepNum, active && sv.stepNumActive, done && sv.stepNumDone]}>
        <Text style={styles.stepNumText}>{done ? '✓' : n}</Text>
      </View>
      <Text style={[styles.stepLabel, active && sv.stepLabelActive]}>{label}</Text>
    </View>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType, maxLength, flex }) {
  return (
    <View style={[styles.field, flex && { flex }]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#333"
        keyboardType={keyboardType}
        maxLength={maxLength}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const ps = StyleSheet.create({
  bar: { paddingVertical: 6, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#333', backgroundColor: 'rgba(0,0,0,0.3)', flexDirection: 'row', alignItems: 'center' },
  text: { fontSize: 11, fontWeight: '500', flex: 1 },
  retryHint: { color: '#7c7cf0', fontSize: 11, fontWeight: '600', marginLeft: 8 },
});

// Disconnect modal styles — v4.1 (full selector, countdown, reassign)
const dm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%', maxWidth: 380, backgroundColor: '#111122', borderWidth: 1,
    borderColor: 'rgba(249,168,37,0.35)', borderRadius: 20, padding: 24, alignItems: 'center', gap: 14,
    shadowColor: '#f9a825', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 12,
  },
  iconRing: { width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: '#f9a825', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(249,168,37,0.10)' },
  iconText: { fontSize: 28, color: '#f9a825' },
  title: { fontSize: 17, fontWeight: '700', color: '#fff', textAlign: 'center' },
  sub: { fontSize: 12, color: '#aaa', textAlign: 'center', lineHeight: 18 },

  // Countdown badge
  countdownBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 16, backgroundColor: 'rgba(249,168,37,0.08)', borderWidth: 1, borderColor: 'rgba(249,168,37,0.25)', borderRadius: 100 },
  countdownLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, color: '#f9a825', textTransform: 'uppercase' },
  countdownValue: { fontSize: 15, fontWeight: '700', color: '#f9a825', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },

  // Assistant list
  listWrapper: { width: '100%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderRadius: 14, padding: 10, backgroundColor: 'rgba(255,255,255,0.02)', minHeight: 60 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, justifyContent: 'center' },
  loadingText: { color: '#888', fontSize: 12 },
  emptyRow: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  emptyText: { color: '#666', fontSize: 12 },
  refreshBtn: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 100, borderWidth: 1, borderColor: '#f9a825' },
  refreshBtnText: { color: '#f9a825', fontSize: 12, fontWeight: '600' },

  assistantCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#1e1e30', backgroundColor: '#0d0d1a' },
  assistantCardSel: { borderColor: '#f9a825', backgroundColor: 'rgba(249,168,37,0.08)' },
  assistantCardBusy: { opacity: 0.45 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(249,168,37,0.15)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#f9a825', fontSize: 14, fontWeight: '700' },
  assistantName: { color: '#e0e0f0', fontSize: 13, fontWeight: '600' },
  assistantSub: { color: '#555', fontSize: 10 },
  busyLabel: { color: '#f9a825', fontSize: 10, fontWeight: '600' },
  checkMark: { color: '#f9a825', fontSize: 16, fontWeight: '700' },

  // Error
  errorBox: { width: '100%', backgroundColor: 'rgba(204,51,51,0.12)', borderWidth: 1, borderColor: 'rgba(204,51,51,0.3)', borderRadius: 10, padding: 10 },
  errorText: { color: '#ff6666', fontSize: 12, textAlign: 'center' },

  // Reassign button — amber to stay visually distinct from the blue "Start Session" btn
  reassignBtn: {
    width: '100%', paddingVertical: 13, backgroundColor: '#f9a825', borderRadius: 100,
    alignItems: 'center', marginTop: 2,
    shadowColor: '#f9a825', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 6,
  },
  reassignBtnOff: { opacity: 0.35, shadowOpacity: 0 },
  reassignBtnText: { color: '#000', fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },

  patientFooter: { color: '#444', fontSize: 10, textAlign: 'center', marginTop: 2 },
});

// Result view styles
const rs = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', padding: 16, backgroundColor: 'rgba(255,255,255,0.03)', borderBottomWidth: 1, borderBottomColor: 'rgba(124,124,240,0.12)' },
  eyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 2, color: '#7c7cf0', textTransform: 'uppercase', marginBottom: 4 },
  title: { fontSize: 18, fontWeight: '600', color: '#e8e8f0' },
  room: { fontSize: 11, color: '#555', marginTop: 3 },
  newSessionBtn: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: 'rgba(91,91,214,0.15)', borderWidth: 1, borderColor: 'rgba(91,91,214,0.3)', borderRadius: 100 },
  newSessionBtnText: { color: '#7c7cf0', fontSize: 12, fontWeight: '600' },
  noPdfBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  noPdfText: { color: '#666', fontSize: 13 },
  pdfErrorBox: { position: 'absolute', bottom: 20, left: 16, right: 16, backgroundColor: 'rgba(204,51,51,0.9)', borderRadius: 12, padding: 14, alignItems: 'center' },
  pdfErrorText: { color: '#fff', fontSize: 13, textAlign: 'center' },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080820' },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 32, paddingHorizontal: 20 },
  monitorScroll: { padding: 16, paddingBottom: 40 },

  centeredCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  connectingTitle: { color: '#c0c0e0', fontSize: 18, fontWeight: '500', textAlign: 'center' },
  connectingHint: { color: '#555', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  reconnectingNote: { color: '#5b5bd6', fontSize: 12, textAlign: 'center', marginTop: 4 },

  card: { width: '100%', maxWidth: 480, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(124,124,240,0.18)', borderRadius: 20, overflow: 'hidden' },
  cardHeader: { alignItems: 'center', paddingTop: 28, paddingBottom: 20, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: 'rgba(124,124,240,0.12)', backgroundColor: 'rgba(91,91,214,0.04)', gap: 5 },
  cardEyebrow: { fontSize: 9, fontWeight: '600', letterSpacing: 2, color: '#7c7cf0', textTransform: 'uppercase' },
  cardTitle: { fontSize: 20, fontWeight: '300', color: '#e8e8f0' },
  formBody: { padding: 24, gap: 16 },

  stepIndicator: { flexDirection: 'row', alignItems: 'center', gap: 0, marginTop: 8 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: '#333', alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  stepLabel: { color: '#666', fontSize: 11 },
  stepLine: { width: 28, height: 1, backgroundColor: 'rgba(124,124,240,0.2)', marginHorizontal: 6 },

  field: { gap: 7 },
  label: { color: '#aaa', fontSize: 12, fontWeight: '500', letterSpacing: 0.4 },
  input: { backgroundColor: '#0d0d1a', borderWidth: 1, borderColor: '#2a2a40', borderRadius: 10, color: '#e8e8f0', fontSize: 14, paddingVertical: 11, paddingHorizontal: 14 },
  row: { flexDirection: 'row', gap: 12 },
  genderRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  genderBtn: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a40', backgroundColor: '#0d0d1a' },
  genderText: { color: '#666', fontSize: 12 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#3a3a5a', backgroundColor: '#0d0d1a', alignItems: 'center', justifyContent: 'center' },
  checkmark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  checkLabel: { flex: 1, color: '#aaa', fontSize: 13, lineHeight: 18 },
  allergyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 100, borderWidth: 1, borderColor: '#2a2a40', backgroundColor: '#0d0d1a' },
  chipText: { color: '#555', fontSize: 12 },

  btn: { backgroundColor: '#5b5bd6', paddingVertical: 13, borderRadius: 100, alignItems: 'center', marginTop: 4, shadowColor: '#5b5bd6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600', letterSpacing: 0.4 },
  ghostBtn: { paddingVertical: 8 },
  ghostBtnText: { color: '#5b5bd6', fontSize: 13, textDecorationLine: 'underline' },
  back: { alignSelf: 'flex-start' },
  backText: { color: '#7c7cf0', fontSize: 13 },

  sectionHeading: { color: '#c0c0e0', fontSize: 14, fontWeight: '600' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16 },
  loadingText: { color: '#666', fontSize: 13 },
  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 16 },
  emptyText: { color: '#666', fontSize: 13 },
  retryBtn: { paddingVertical: 7, paddingHorizontal: 18, borderRadius: 100, borderWidth: 1, borderColor: '#5b5bd6' },
  retryText: { color: '#7c7cf0', fontSize: 13 },
  assistantCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#1e1e30', backgroundColor: '#0d0d1a' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(91,91,214,0.2)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#a0a0f0', fontSize: 16, fontWeight: '700' },
  assistantName: { color: '#e0e0f0', fontSize: 13, fontWeight: '600' },
  checkIcon: { color: '#5b5bd6', fontSize: 18, fontWeight: '700' },
  errorBox: { backgroundColor: 'rgba(204,51,51,0.1)', borderWidth: 1, borderColor: 'rgba(204,51,51,0.3)', borderRadius: 10, padding: 12 },
  errorText: { color: '#ff6666', fontSize: 12 },

  readyTitle: { fontSize: 24, fontWeight: '300', color: '#e8e8f0' },
  readyPatient: { fontSize: 13, color: '#a0a0c0', fontStyle: 'italic' },
  readyHint: { color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  roomBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: 'rgba(91,91,214,0.1)', borderWidth: 1, borderColor: 'rgba(91,91,214,0.2)', borderRadius: 100 },
  roomLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, color: '#5b5bd6', textTransform: 'uppercase' },
  roomCodeText: { fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontWeight: '700', color: '#c0c0e0', letterSpacing: 1.3 },
  bigBtn: { width: '100%', paddingVertical: 16, backgroundColor: '#5b5bd6', borderRadius: 100, alignItems: 'center', shadowColor: '#5b5bd6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8 },
  bigBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  monitorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(124,124,240,0.12)', borderRadius: 12, marginBottom: 12 },
  monitorLabel: { color: '#555', fontSize: 10, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  monitorValue: { color: '#c0c0e0', fontSize: 14, fontWeight: '600' },
  phasePill: { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 100 },
  phaseText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  instructionBox: { backgroundColor: 'rgba(91,91,214,0.06)', borderWidth: 1, borderColor: 'rgba(91,91,214,0.15)', borderRadius: 12, padding: 14, marginBottom: 12, gap: 4 },
  instructionLabel: { color: '#5b5bd6', fontSize: 10, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  instructionText: { color: '#c0c0e0', fontSize: 15, lineHeight: 22 },
  eyePreviewRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', marginBottom: 12 },
  eyePreviewCard: { alignItems: 'center', gap: 4 },
  eyePreviewLabel: { color: 'rgba(180,180,180,0.6)', fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 2, textTransform: 'uppercase' },
  eyePanelWrapper: { borderRadius: 6, overflow: 'hidden' },
  eyeCentreDivider: { width: 2, backgroundColor: '#1a1a1a', marginTop: 22 },
  infoRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 12, marginBottom: 8 },
  infoLabel: { color: '#555', fontSize: 11, fontWeight: '600' },
  infoVal: { color: '#c0c0e0', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontWeight: '700' },
  completeBox: { backgroundColor: 'rgba(76,175,80,0.1)', borderWidth: 1, borderColor: 'rgba(76,175,80,0.3)', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 8 },
  completeText: { color: '#81c784', fontSize: 16, fontWeight: '600' },

  // PDF result section (same pattern as ECG PDF)
  pdfSection: { flex: 1, backgroundColor: '#000' },
  pdf: { flex: 1, width: '100%' },
});

const sv = StyleSheet.create({
  genderBtnSel: { borderColor: '#5b5bd6', backgroundColor: 'rgba(91,91,214,0.15)' },
  genderTextSel: { color: '#a0a0f0', fontWeight: '600' },
  checkboxOn: { backgroundColor: '#5b5bd6', borderColor: '#5b5bd6' },
  chipSel: { borderColor: '#5b5bd6', backgroundColor: 'rgba(91,91,214,0.15)' },
  chipTextSel: { color: '#a0a0f0', fontWeight: '600' },
  btnOff: { opacity: 0.35, shadowOpacity: 0 },
  endBtn: { backgroundColor: '#c62828', shadowColor: '#c62828', marginTop: 20 },
  stepNumActive: { backgroundColor: '#5b5bd6', borderColor: '#5b5bd6' },
  stepNumDone: { backgroundColor: 'rgba(91,91,214,0.3)', borderColor: '#5b5bd6' },
  stepLabelActive: { color: '#e0e0f0' },
  assistantCardSel: { borderColor: '#5b5bd6', backgroundColor: 'rgba(91,91,214,0.08)' },
  assistantCardBusy: { opacity: 0.5 },
});