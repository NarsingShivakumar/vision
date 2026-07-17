/**
 * ControllerScreen.js v5.7 — Reconnection Strategy & Network Warnings
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, StatusBar, ActivityIndicator,
  KeyboardAvoidingView, Platform, Dimensions, Modal, Animated,
  Image,
  Keyboard,
  FlatList,
  Alert,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Snackbar } from 'react-native-snackbar';

// showSnack — lazy require so native Snackbar module is resolved AFTER bridge init.
const showSnack = (text, backgroundColor = '#D32F2F') => {
  const message = String(text || 'Something went wrong.');

  try {
    Snackbar.show({
      text: message,
      duration: Snackbar.LENGTH_LONG,
      backgroundColor,
    });
  } catch (error) {
    console.warn('[showSnack] failed:', error?.message, '|', message);

    // Fallback so the user still sees the message.
    Alert.alert('', message);
  }
};

import localPeerService from '../services/localPeerService';
import socketService from '../services/socketService';
import WifiGuard from '../components/WifiGuard';
import { useWifiGuard } from '../hooks/useWifiGuard';
import EyePanel from '../components/EyePanel';
import { generatePlateDots, getPlate, TOTAL_PLATES, preloadIshiharaPlates } from '../utils/ishiharaPanel';
import apiService from '../../api/AxiosClient';
import { fetchActiveAssistantsApi, reassignAssistantApi, submitRegistrationApi, getDepartments, getDesignations, sendEmployeeDetailsList } from '../../api/ApiService';
import { useDispatch, useSelector } from 'react-redux';
import { fetchResultData } from '../../store/slices/resultSlice';
import { aiRegisteredPatient, clearAiRegisteredPatientData } from '../../store/slices/AiPatientRegisteredSlice';
import VisionResultView from '../components/VisionResultView';
import { LANGUAGE_OPTIONS } from '../../assets/constants';
import { appColor, red } from '../../assets/colors';
import NetInfo from '@react-native-community/netinfo';
import { isKioskModeEnabled, startKioskMode, stopKioskMode } from '../services/kioskMode';
import CustomHeader from '../components/CustomHeader';

// ─── Constants ────────────────────────────────────────────────────────────────
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
const RECONNECT_GRACE_SECONDS = 90;
const { width: W } = Dimensions.get('window');
const EYE_W = Math.floor((W - 38) / 2);
const EYE_H = Math.round(EYE_W * (4 / 3));

const CONTROLLER_PREVIEW_LETTER_SIZE = 64;

// ─────────────────────────────────────────────────────────────────────────────
// AssistantDisconnectedModal
// ─────────────────────────────────────────────────────────────────────────────
function AssistantDisconnectedModal({ visible, roomCode, patientName, onReassignSuccess, onSelfDisconnect }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const [timeLeft, setTimeLeft] = useState(RECONNECT_GRACE_SECONDS);
  const countdownRef = useRef(null);
  const [assistants, setAssistants] = useState([]);
  const [loadingAssistants, setLoadingAssistants] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const pollRef = useRef(null);
  const reassignTimeoutRef = useRef(null);
  const [reassigning, setReassigning] = useState(false);
  const [reassignError, setReassignError] = useState('');

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

  useEffect(() => {
    if (!visible) {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setTimeLeft(RECONNECT_GRACE_SECONDS);
      setSelectedId('');
      setReassignError('');
      setReassigning(false);
      return;
    }
    setTimeLeft(RECONNECT_GRACE_SECONDS);
    countdownRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { clearInterval(countdownRef.current); countdownRef.current = null; return 0; }
        return t - 1;
      });
    }, 1000);
    fetchAssistantsModal();
    pollRef.current = setInterval(fetchAssistantsModal, 5000);
    return () => {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [visible]);

  async function fetchAssistantsModal() {
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
    if (reassignTimeoutRef.current) clearTimeout(reassignTimeoutRef.current);
    try {
      await reassignAssistantApi(roomCode, selectedId);
      onReassignSuccess?.();
      reassignTimeoutRef.current = setTimeout(() => {
        setReassigning(false);
        setReassignError('Assistant took too long to connect. Please try again or choose another.');
      }, 20000);
    } catch (err) {
      setReassigning(false);
      setReassignError(err?.response?.data?.message ?? err?.message ?? 'Could not reassign. Please try again.');
    }
  }

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={dm.backdrop}>
        <View style={dm.card}>
          <Animated.View style={[dm.iconRing, { opacity: pulse }]}>
            <Text style={dm.iconText}>⚠</Text>
          </Animated.View>
          <Text style={dm.title}>Assistant Disconnected</Text>
          <Text style={dm.sub}>
            The assistant has lost connection.{'\n'}
            Select an available assistant to continue the session.
          </Text>
          {timeLeft > 0 && (
            <View style={dm.countdownBadge}>
              <Text style={dm.countdownLabel}>WAITING</Text>
              <Text style={dm.countdownValue}>{timeLeft}s</Text>
            </View>
          )}
          <View style={dm.listWrapper}>
            {loadingAssistants && assistants.length === 0 ? (
              <View style={dm.loadingRow}>
                <ActivityIndicator color="#f9a825" size="small" />
                <Text style={dm.loadingText}>Loading available assistants…</Text>
              </View>
            ) : assistants.length === 0 ? (
              <View style={dm.emptyRow}>
                <Text style={dm.emptyText}>No assistants are currently online.</Text>
                <TouchableOpacity style={dm.refreshBtn} onPress={fetchAssistantsModal}>
                  <Text style={dm.refreshBtnText}>↺ Refresh</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                <View style={{ gap: 8 }}>
                  {assistants.map((a) => {
                    const isBusy = a.busy === true;
                    const isSel = selectedId === a.assistantId;
                    return (
                      <TouchableOpacity
                        key={a.assistantId}
                        style={[dm.assistantCard, isSel && !isBusy && dm.assistantCardSel, isBusy && dm.assistantCardBusy]}
                        onPress={() => {
                          if (!isBusy) setSelectedId(a.assistantId); setReassignError('');
                        }}
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
          {reassignError ? (
            <View style={dm.errorBox}>
              <Text style={dm.errorText}>⚠ {reassignError}</Text>
            </View>
          ) : null}
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
          {patientName ? (
            <Text style={dm.patientFooter}>Patient: {patientName} · Room {roomCode}</Text>
          ) : null}
          {onSelfDisconnect && (
            <TouchableOpacity style={dm.selfDisconnectBtn} onPress={onSelfDisconnect} activeOpacity={0.85}>
              <Text style={dm.selfDisconnectText}>⏏  Disconnect from VR Host</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InlineKioskSetup
// ─────────────────────────────────────────────────────────────────────────────
function InlineKioskSetup({ onDone }) {
  const [kioskId, setKioskId] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!kioskId.trim()) { showSnack('Please enter the Kiosk Id'); return; }
    try {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) { showSnack('No internet connection.'); return; }
      setLoading(true);
      const response = await apiService.get(
        'api/v1/twelvelead/ecg/kiosk/check',
        { params: { kioskId: kioskId.trim() } }
      );
      console.log("handleRegister::", response)
      const setupFlag = response?.data?.response?.setupFlag;
      const message = response?.data?.message;
      if (setupFlag === true) {
        await AsyncStorage.setItem('isFirstTimeLaunch', 'true');
        await AsyncStorage.setItem('kioskId', kioskId.trim());
        Keyboard.dismiss();
        onDone(kioskId.trim());
      } else {
        showSnack(message ?? 'Kiosk ID not found. Please check and try again.');
      }
    } catch (e) {
      console.error('[InlineKioskSetup] API error:', e);
      showSnack('Error checking kiosk. Please try again.');
    } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView
      style={auth.root}
      enabled={Platform.OS === 'ios'}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <StatusBar barStyle="light-content" backgroundColor={appColor} />

      <View style={auth.logoBox}>
        <Image source={require('../../assets/reach_home.png')} style={auth.logo} />
      </View>

      <ScrollView
        contentContainerStyle={[auth.scrollContent]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={auth.card}>
          <Text style={auth.title}>Setup Kiosk</Text>
          <Text style={auth.subtitle}>Enter your Kiosk Registration ID</Text>

          <TextInput
            style={auth.input}
            placeholder="Kiosk Registration Id"
            placeholderTextColor={appColor}
            value={kioskId}
            onChangeText={setKioskId}
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={handleRegister}
          />

          <TouchableOpacity
            style={[auth.btn, loading && { opacity: 0.6 }]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={auth.btnText}>Register</Text>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InlineLogin
// ─────────────────────────────────────────────────────────────────────────────
function InlineLogin({ onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username.trim()) { showSnack('Please enter the Username'); return; }
    if (!password) { showSnack('Please enter the Password'); return; }
    try {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) { showSnack('No internet connection.'); return; }
      setLoading(true);
      const response = await apiService.post(
        'authentication/login/without/regid',
        { username: username.trim(), password, isTwelveLeadEcg: true }
      );
      const jsonResponse = response?.data ?? {};
      const message = jsonResponse?.message ?? 'Login failed. Please try again.';
      const flag = jsonResponse?.flag ?? false;
      const status = jsonResponse?.status ?? -1;
      if (status === 0 && flag === true) {
        const responseData = jsonResponse?.response ?? {};
        const token = jsonResponse?.token ?? responseData?.token ?? '';
        await AsyncStorage.setItem('loginResponseEntityToken', String(token));
        await AsyncStorage.setItem('loginInfo', JSON.stringify(jsonResponse));
        await AsyncStorage.setItem('isLoggedIn', '1');
        await AsyncStorage.setItem('doctorId', '');
        await AsyncStorage.setItem('isFirstTimeLaunch', 'true');
        const kioskId = (await AsyncStorage.getItem('kioskId')) ?? '';
        Keyboard.dismiss();
        onDone(jsonResponse, kioskId);
      } else {
        showSnack(message || 'Login failed. Please try again.');
      }
    } catch (e) {
      console.error('[InlineLogin] API error:', e);
      try { showSnack('Login error. Please try again.'); } catch (_) { }
    } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView
      style={auth.root}
      enabled={Platform.OS === 'ios'}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <StatusBar barStyle="light-content" backgroundColor={appColor} />

      <View style={auth.logoBox}>
        <Image source={require('../../assets/reach_home.png')} style={auth.logo} />
      </View>

      <ScrollView
        contentContainerStyle={auth.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={auth.card}>
          <Text style={auth.title}>Welcome Back</Text>
          <Text style={auth.subtitle}>Login to your account</Text>

          <TextInput
            style={auth.input}
            placeholder="Username / Email"
            placeholderTextColor={appColor}
            value={username}
            onChangeText={(t) => setUsername(t.trim())}
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="next"
          />

          <View style={auth.passRow}>
            <TextInput
              style={[auth.input, { flex: 1, marginVertical: 0 }]}
              placeholder="Password"
              placeholderTextColor={appColor}
              secureTextEntry={!passwordVisible}
              value={password}
              onChangeText={setPassword}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity
              onPress={() => setPasswordVisible((v) => !v)}
              style={auth.eyeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={{ color: appColor, fontSize: 18 }}>
                {passwordVisible ? '🙈' : '👁'}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[auth.btn, loading && { opacity: 0.6 }]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={auth.btnText}>Log In</Text>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main ControllerScreen
// ─────────────────────────────────────────────────────────────────────────────
export default function ControllerScreen({ route, navigation }) {
  const [view, setView] = useState(
    localPeerService.isConnected() ? 'registration' : 'connecting'
  );
  const [authState, setAuthState] = useState('checking');

  const [peerConnected, setPeerConnected] = useState(localPeerService.isConnected());
  const [peerRtt, setPeerRtt] = useState(null);
  const [peerReconnecting, setPeerReconnecting] = useState(false);
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const [networkWarning, setNetworkWarning] = useState(false); // <--- NEW: Tracks network drops

  // ── Kiosk pin state — true ONLY while a test is actually in progress.
  const [testInProgress, setTestInProgress] = useState(false);

  // Starts at 'home' instead of 'details' to render HomePage2 equivalent first
  const [regStep, setRegStep] = useState('home');
  const [isExistingPatient, setIsExistingPatient] = useState(false);

  const [profileData, setProfileData] = useState({
    name: '',
    username: '',
    employeeId: '',
    mobileNumber: '',
    designationName: '',
    kioskId: ''
  });

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
    getValues,
  } = useForm({
    defaultValues: { name: '', age: '', mobile: '', gender: '' },
    mode: 'onChange',
  });
  const [regGlasses, setRegGlasses] = useState(false);
  const [regAllergies, setRegAllergies] = useState({ ...INIT_ALLERGIES });
  const [regLanguage, setRegLanguage] = useState('en');
  const [activeAssistants, setActiveAssistants] = useState([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState('');

  const [loadingAssistants, setLoadingAssistants] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const [registeringPatient, setRegisteringPatient] = useState(false);
  const [patientRegistrationId, setPatientRegistrationId] = useState(null);

  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);

  const dispatch = useDispatch();

  // ── Search State (Redux) ───────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const searchResults = useSelector(state => state.aiRegisteredPatient?.aiRegisteredPatientData || []);
  const isSearching = useSelector(state => state.aiRegisteredPatient?.isLoading || false);
  const searchError = useSelector(state => state.aiRegisteredPatient?.isError || false);

  const [roomCode, setRoomCode] = useState('');
  const [patientName, setPatientName] = useState('');
  const [vrState, setVrState] = useState({
    phase: 'waiting', instruction: 'Ask the patient to put on the VR headset', optotype: null,
    isComplete: false,
    showLeft: true, showRight: true,
    colorShowLeft: true, colorShowRight: true,
    nearShowLeft: true, nearShowRight: true,
    astigShowLeft: true, astigShowRight: true,
    plateIndex: 0, nearOptotype: null,
    isLensCheck: false, lensCheckEye: 'both',
  });

  const plateDots = React.useMemo(() => {
    return vrState.phase === 'color' ? generatePlateDots(getPlate(vrState.plateIndex) ?? 0) : [];
  }, [vrState.phase, vrState.plateIndex]);

  const [assistantDisconnected, setAssistantDisconnected] = useState(false);
  const [hasAssistantJoined, setHasAssistantJoined] = useState(false);
  const [resultReady, setResultReady] = useState(false);
  const [resultPdfUri, setResultPdfUri] = useState('');
  const [pdfError, setPdfError] = useState(null);

  const unsubs = useRef([]);

  const assistantJoinTimeoutRef = useRef(null);
  const authCheckInProgress = useRef(false);
  const clearAssistantJoinTimeout = useCallback(() => {
    if (assistantJoinTimeoutRef.current) {
      clearTimeout(assistantJoinTimeoutRef.current);
      assistantJoinTimeoutRef.current = null;
    }
  }, []);

  useWifiGuard();
  const handleWifiRestore = useCallback(() => {
    if (!localPeerService.isConnected()) localPeerService.manualReconnect();
  }, []);

  // ── Kiosk safety net & preload ────────────────────────────────────────────
  useEffect(() => {
    isKioskModeEnabled().then((enabled) => {
      if (enabled) stopKioskMode();
    });
    preloadIshiharaPlates();
  }, []);

  // ── Auth check ───────────────────────────────────────────────────────────
  const runAuthCheck = useCallback(() => {
    if (authCheckInProgress.current) return;
    authCheckInProgress.current = true;
    setAuthState('checking');
    setTimeout(async () => {
      try {
        const checkStorage = async () => {
          const isFirstTimeLaunch = await AsyncStorage.getItem('isFirstTimeLaunch');
          if (isFirstTimeLaunch === null) return 'kiosk_setup';
          const isLoggedIn = await AsyncStorage.getItem('isLoggedIn');
          if (isLoggedIn !== '1') return 'login';
          return 'ready';
        };

        const timeout = new Promise((resolve) => setTimeout(() => resolve('kiosk_setup'), 3000));
        const finalState = await Promise.race([checkStorage(), timeout]);
        setAuthState(finalState);
      } catch (e) {
        console.error('[ControllerScreen] auth check error:', e);
        setAuthState('kiosk_setup');
      } finally {
        authCheckInProgress.current = false;
      }
    }, 150);
  }, []);

  // ── Redux Search Handlers ─────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      showSnack('Please enter a name or ID to search.');
      return;
    }

    dispatch(clearAiRegisteredPatientData());
    dispatch(aiRegisteredPatient({
      searchValue: searchQuery.trim(),
      isForAllPatients: false
    }));
  }, [searchQuery, dispatch]);

  const selectPatient = useCallback((patient) => {
    resetForm({ name: '', age: '', mobile: '', gender: '' });
    const pid = patient.employeeId || patient.patientId;

    let calcAge = '';
    if (patient.dateOfBirth) {
      const birthYear = new Date(patient.dateOfBirth).getFullYear();
      const currentYear = new Date().getFullYear();
      calcAge = String(currentYear - birthYear);
    }

    resetForm({
      name: patient.name || patient.firstName || '',
      age: calcAge,
      mobile: patient.mobileNumber || patient.contactNumber || '',
      gender: patient.gender ? (patient.gender.toLowerCase() === 'male' ? 'Male' : patient.gender.toLowerCase() === 'female' ? 'Female' : 'Others') : ''
    });

    setPatientRegistrationId(pid);
    setIsExistingPatient(true);
    setRegStep('extra_details');
  }, [resetForm]);

  const onKioskSetupDone = useCallback(() => {
    Keyboard.dismiss();
    setTimeout(() => setAuthState('login'), 200);
  }, []);

  const onLoginDone = useCallback(async (loginData, kioskId) => {
    localPeerService.send('auth_sync', {
      kioskId,
      loginInfo: JSON.stringify(loginData),
      token: loginData.token ?? '',
    });
    Keyboard.dismiss();
    setTimeout(() => setAuthState('ready'), 200);
  }, []);

  // ── Load Profile Data for HomePage2 ───────────────────────────────────────
  useEffect(() => {
    if (authState === 'ready') {
      const fetchProfile = async () => {
        try {
          const loginInfoStr = await AsyncStorage.getItem('loginInfo');
          const kioskId = await AsyncStorage.getItem('kioskId');

          if (loginInfoStr) {
            const parsed = JSON.parse(loginInfoStr);
            const resp = parsed?.response || {};
            const ulb = resp.ulbList?.[0] || {};

            setProfileData({
              name: resp.name || '',
              username: resp.username || '',
              employeeId: ulb.employeeId || '',
              mobileNumber: resp.mobileNumber || '',
              designationName: ulb.designationName || '',
              kioskId: kioskId || ''
            });
          }
        } catch (e) {
          console.warn('[ControllerScreen] Error loading profile data:', e);
        }
      };

      fetchProfile();
    }
  }, [authState]);

  const handleLogout = useCallback(async () => {
    localPeerService.send('auth_logout', {});
    await AsyncStorage.removeItem('isFirstTimeLaunch');
    await AsyncStorage.removeItem('kioskId');
    await AsyncStorage.removeItem('loginInfo');
    await AsyncStorage.removeItem('isLoggedIn');
    await AsyncStorage.removeItem('loginResponseEntityToken');
    await AsyncStorage.removeItem('doctorId');
    setAuthState('kiosk_setup');
    setRegStep('home');
  }, []);

  // ── Call Declined Listener ─────────────────────────────────────────────────
  useEffect(() => {
    const unsub = localPeerService.on('call_declined', (data) => {
      if (data?.roomCode && roomCode && data.roomCode !== roomCode) return;
      clearAssistantJoinTimeout();
      setAssistantDisconnected(false);
      setView('registration');
      setRegStep('assistant');
      setSubmitError(data?.message ?? 'The assistant declined the call. Please select another assistant.');
    });
    return () => unsub();
  }, [roomCode, clearAssistantJoinTimeout]);

  // ── Peer listeners ────────────────────────────────────────────────────────
  useEffect(() => {
    const U = unsubs.current;

    U.push(localPeerService.on('network_warning', (data) => { // <--- NEW: Listener for Network Unstable
      setNetworkWarning(data.warning);
    }));

    U.push(localPeerService.on('connected', () => {
      setPeerConnected(true);
      setPeerReconnecting(false);
      setReconnectFailed(false);
      setView((prev) => prev === 'connecting' ? 'registration' : prev);
      runAuthCheck();
    }));
    U.push(localPeerService.on('disconnected', () => setPeerConnected(false)));
    U.push(localPeerService.on('reconnecting', () => {
      setPeerReconnecting(true); setPeerConnected(false); setReconnectFailed(false);
    }));
    U.push(localPeerService.on('reconnectfailed', () => {
      setReconnectFailed(true); setPeerReconnecting(false); setPeerConnected(false);
    }));
    U.push(localPeerService.on('pingrtt', ({ rtt }) => setPeerRtt(rtt)));

    U.push(localPeerService.on('vr_state_update', (state) => {
      setVrState((prev) => ({ ...prev, ...state }));
      if ((state.phase && state.phase !== 'waiting') || state.isLensCheck) {
        setView((prev) => prev === 'ready' ? 'monitoring' : prev);
      }
      if (state.assistantDisconnected === true) setAssistantDisconnected(true);
      if (state.assistantDisconnected === false) {
        setAssistantDisconnected(false);
        setHasAssistantJoined(true);
        clearAssistantJoinTimeout();
      }
      if (state.resultReady === true) {
        const uri = state.resultPdfUri ?? '';
        setResultPdfUri(uri);
        setResultReady(true);
        setPdfError(null);
        stopKioskMode();
        setTestInProgress(false);
        setView('result');
        if (state.resultId) dispatch(fetchResultData(state.resultId));
      }
    }));

    U.push(localPeerService.on('vr_session_started', ({ patientName: pn }) => {
      if (pn) setPatientName(pn);
      setView('monitoring');
    }));
    U.push(localPeerService.on('vr_session_ended', () => {
      stopKioskMode();
      setTestInProgress(false);
      resetSession();
    }));
    U.push(localPeerService.on('peer_self_disconnect', () => {
      stopKioskMode();
      setTestInProgress(false);
      localPeerService.destroy();
      navigation.replace('RoleAndConnectScreen');
    }));

    if (localPeerService.isConnected()) { setPeerConnected(true); runAuthCheck(); }
    fetchAssistants();

    socketService.connect('controller');

    Promise.allSettled([
      getDepartments().then(res => setDepartments(res?.data?.response || res?.response || [])).catch(console.error),
      getDesignations().then(res => setDesignations(res?.data?.response || res?.response || [])).catch(console.error),
    ]);

    return () => {
      stopKioskMode();
      U.forEach((fn) => fn());
      clearAssistantJoinTimeout();
    };
  }, []); // eslint-disable-line

  // ── Helpers ───────────────────────────────────────────────────────────────
  const resetSession = useCallback(() => {
    clearAssistantJoinTimeout();
    setView('registration');
    setRoomCode('');
    setRegStep('home');
    setIsExistingPatient(false);
    setSelectedAssistantId('');
    setHasAssistantJoined(false);
    setSubmitError('');
    setPatientName('');
    setPatientRegistrationId(null);
    resetForm();
    setRegGlasses(false);
    setRegAllergies({ ...INIT_ALLERGIES });
    setRegLanguage('en');
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
    setAssistantDisconnected(false);
    setResultReady(false);
    setResultPdfUri('');
    setPdfError(null);
  }, [resetForm, clearAssistantJoinTimeout]);

  const fetchAssistants = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoadingAssistants(true);
    try {
      const list = await fetchActiveAssistantsApi();
      setActiveAssistants(Array.isArray(list) ? list : []);
    } catch { setActiveAssistants([]); }
    finally { if (!isPolling) setLoadingAssistants(false); }
  }, []);

  // ── Polling ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let pollInterval;
    if (view === 'registration' && regStep === 'assistant') {
      pollInterval = setInterval(() => fetchAssistants(true), 5000);
    }
    return () => { if (pollInterval) clearInterval(pollInterval); };
  }, [view, regStep, fetchAssistants]);

  // We separate the logic from handleSubmit so we can call it manually for existing patients
  const proceedToAssistant = async (formValues) => {
    setSubmitError('');

    if (isExistingPatient && patientRegistrationId) {
      fetchAssistants();
      setRegStep('assistant');
      return;
    }

    setRegisteringPatient(true);
    try {
      const ageNum = formValues.age ? Number(formValues.age) : null;
      let dateOfBirth = null;
      if (ageNum && ageNum > 0) {
        const birthYear = new Date().getFullYear() - ageNum;
        dateOfBirth = new Date(`${birthYear}-01-01`).getTime();
      }

      const defaultDeptId = departments?.length > 0 ? String(departments[0].id) : null;
      const defaultDesignId = designations?.length > 0 ? Number(designations[0].id) : null;
      const userData = {
        name: formValues.name.trim(),
        mobileNumber: formValues.mobile.trim(),
        gender: formValues.gender,
        employeeId: null,
        dateOfBirth: dateOfBirth,
        photoPath: null,
        departmentId: defaultDeptId,
        designationId: defaultDesignId,
        mobileEmployeeRegistration: true,
      };

      const responseData = await sendEmployeeDetailsList(userData);

      if (!responseData) {
        setSubmitError('Patient registration failed. Please try again.');
        return;
      }

      const registeredId =
        responseData?.response?.employeeId ??
        responseData?.response?.patientId ??
        responseData?.response?.id ??
        null;
      setPatientRegistrationId(registeredId);

      fetchAssistants();
      setRegStep('assistant');

    } catch (e) {
      const axiosErr = e?.error ?? e;
      const status = axiosErr?.response?.status;
      const serverMsg = axiosErr?.response?.data?.message ?? axiosErr?.response?.data?.error;
      const fallback = axiosErr?.message ?? 'Patient registration failed. Please try again.';
      const userMsg = serverMsg ?? fallback;
      setSubmitError('Assistant is busy. Please select another.');
    } finally {
      setRegisteringPatient(false);
    }
  };

  const goToAssistantStep = () => {
    if (isExistingPatient) {
      proceedToAssistant(getValues());
    } else {
      handleSubmit(proceedToAssistant)();
    }
  };

  const submitRegistration = useCallback(async () => {
    if (!selectedAssistantId || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    setHasAssistantJoined(false);
    setAssistantDisconnected(false);
    clearAssistantJoinTimeout();

    const formValues = getValues();
    const payload = {
      patientName: formValues.name.trim(),
      patientAge: formValues.age ? Number(formValues.age) : null,
      patientGender: formValues.gender,
      mobileNumber: formValues.mobile.trim(),
      language: regLanguage,
      wearingGlasses: regGlasses,
      assistantId: selectedAssistantId,
      patientId: patientRegistrationId,
      ...regAllergies,
    };
    try {
      const res = await submitRegistrationApi(payload);
      const rc = res.roomCode;
      const pn = res.patientName ?? formValues.name.trim();
      setRoomCode(rc);
      setPatientName(pn);
      localPeerService.send('session_registered', { roomCode: rc, patientName: pn });
      setView('ready');

      startTest();
      assistantJoinTimeoutRef.current = setTimeout(() => {
        assistantJoinTimeoutRef.current = null;
        localPeerService.send('end_session', { roomCode: rc });
        setAssistantDisconnected(false);
        setView('registration');
        setRegStep('assistant');
        setSubmitError('Assistant took too long to connect. Please select another.');
      }, 20000);
    } catch (err) {
      setSubmitError(err?.response?.data?.message ?? err?.message ?? 'Could not start session.');
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedAssistantId, submitting, getValues,
    regLanguage, regGlasses, regAllergies,
    patientRegistrationId,
    clearAssistantJoinTimeout,
  ]);

  const startTest = useCallback(() => {
    localPeerService.send('start_test', { roomCode });
    startKioskMode();
    setTestInProgress(true);
    setView('monitoring');
  }, [roomCode]);

  const endSession = useCallback(() => {
    clearAssistantJoinTimeout();
    localPeerService.send('end_session', { roomCode });
    stopKioskMode();
    setTestInProgress(false);
    resetSession();
  }, [roomCode, resetSession, clearAssistantJoinTimeout]);

  const handleManualReconnect = useCallback(() => {
    setReconnectFailed(false); setPeerReconnecting(true);
    localPeerService.manualReconnect();
  }, []);

  const handleReassignSuccess = useCallback(() => {
    console.log('[ControllerScreen] Reassign sent — waiting for assistant_joined');
  }, []);

  const handleSelfDisconnect = useCallback(() => {
    stopKioskMode();
    setTestInProgress(false);
    localPeerService.send('peer_self_disconnect', {});
    setTimeout(() => { localPeerService.destroy(); navigation.replace('RoleAndConnectScreen'); }, 150);
  }, [navigation]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER A: Connecting
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'connecting') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.root}>
          <WifiGuard onRestore={handleWifiRestore} />

          {/* <--- NEW: NETWORK WARNING BANNER ---> */}
          {networkWarning && (
            <View style={sv.networkStatusContainer}>
              <Text style={sv.unstableConnectionText}>⚠ Unstable Network Connection</Text>
            </View>
          )}

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
                <TouchableOpacity style={styles.ghostBtn}
                  onPress={() => { localPeerService.destroy(); navigation.replace('RoleAndConnectScreen'); }}>
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
  // Auth gate
  // ═══════════════════════════════════════════════════════════════════════════
  if (authState !== 'ready') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.root}>
          <WifiGuard onRestore={handleWifiRestore} />

          {networkWarning && (
            <View style={sv.networkStatusContainer}>
              <Text style={sv.unstableConnectionText}>⚠ Unstable Network Connection</Text>
            </View>
          )}

          <StatusBar barStyle="light-content" backgroundColor="#080820" />
          <PeerStatusBar connected={peerConnected} rtt={peerRtt}
            reconnecting={peerReconnecting} reconnectFailed={reconnectFailed}
            onRetry={handleManualReconnect} />
          {authState === 'checking' && (
            <View style={styles.centeredCard}>
              <ActivityIndicator color="#5b5bd6" size="large" />
              <Text style={styles.connectingTitle}>Checking authentication…</Text>
            </View>
          )}
          {authState === 'kiosk_setup' && <InlineKioskSetup onDone={onKioskSetupDone} />}
          {authState === 'login' && <InlineLogin onDone={onLoginDone} />}
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER B: Registration (Home -> Form -> Assistant)
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'registration') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.root}>
          <WifiGuard onRestore={handleWifiRestore} />

          {networkWarning && (
            <View style={sv.networkStatusContainer}>
              <Text style={sv.unstableConnectionText}>⚠ Unstable Network Connection</Text>
            </View>
          )}

          <PeerStatusBar connected={peerConnected} rtt={peerRtt}
            reconnecting={peerReconnecting} reconnectFailed={reconnectFailed}
            onRetry={handleManualReconnect} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardEyebrow}>Controller · Dashboard</Text>
                  <Text style={styles.cardTitle}>{regStep === 'home' ? 'Home' : regStep === 'search' ? 'Search Patient' : 'Patient Registration'}</Text>

                  {(regStep === 'details' || regStep === 'extra_details' || regStep === 'assistant') && (
                    <View style={styles.stepIndicator}>
                      <StepDot
                        n={1}
                        active={regStep === 'details' || regStep === 'extra_details'}
                        done={regStep === 'assistant'}
                        label="Details"
                      />
                      <View style={styles.stepLine} />
                      <StepDot
                        n={2}
                        active={regStep === 'assistant'}
                        done={false}
                        label="Assistant"
                      />
                    </View>
                  )}
                </View>

                <View style={styles.formBody}>

                  {/* ── Step 0: HomePage2 Dashboard ── */}
                  {regStep === 'home' && (
                    <View style={sv.homeWrapper}>

                      <View style={sv.profileCard}>
                        <View style={sv.profileHeaderRow}>
                          <Text style={sv.profileTitle}>Operator Profile</Text>
                          <TouchableOpacity style={sv.logoutBtn} onPress={handleLogout}>
                            <Text style={sv.logoutBtnText}>Logout</Text>
                          </TouchableOpacity>
                        </View>

                        <View style={sv.profileData}>
                          <ProfileRow label="Name" value={profileData.name} />
                          <ProfileRow label="Username" value={profileData.username} />
                          <ProfileRow label="Mobile Number" value={profileData.mobileNumber} />
                          <ProfileRow label="Designation" value={profileData.designationName} />
                          <ProfileRow label="Kiosk ID" value={profileData.kioskId} />
                        </View>
                      </View>

                      <Text style={sv.actionPrompt}>What would you like to do?</Text>
                      <View style={sv.actionRow}>
                        <TouchableOpacity style={sv.actionBtn} onPress={() => {
                          setIsExistingPatient(false);
                          resetForm({ name: '', age: '', mobile: '', gender: '' });
                          setRegStep('details');
                        }} activeOpacity={0.85}>
                          <Text style={sv.actionBtnText}>Register</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[sv.actionBtn, sv.actionBtnGhost]} onPress={() => {
                          setSearchQuery('');
                          dispatch(clearAiRegisteredPatientData());
                          setRegStep('search');
                        }} activeOpacity={0.85}>
                          <Text style={sv.actionBtnGhostText}>Registered</Text>
                        </TouchableOpacity>
                      </View>

                    </View>
                  )}

                  {/* ── Step 0.5: Search Registered Patient ── */}
                  {regStep === 'search' && (
                    <View style={{ flex: 1, minHeight: 400 }}>
                      <TouchableOpacity style={styles.back} onPress={() => setRegStep('home')}>
                        <Text style={styles.backText}>← Back to Home</Text>
                      </TouchableOpacity>

                      <View style={sv.searchBarRow}>
                        <TextInput
                          style={sv.searchInput}
                          placeholder="Search by name or ID..."
                          placeholderTextColor="#555"
                          value={searchQuery}
                          onChangeText={setSearchQuery}
                          onSubmitEditing={handleSearch}
                          returnKeyType="search"
                        />
                        <TouchableOpacity
                          style={sv.searchBtn}
                          onPress={handleSearch}
                          disabled={isSearching}
                        >
                          {isSearching ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={sv.searchBtnText}>Search</Text>
                          )}
                        </TouchableOpacity>
                      </View>

                      <View style={{ flex: 1, marginTop: 16 }}>
                        {isSearching ? (
                          <View style={sv.centerMsg}>
                            <ActivityIndicator size="large" color="#5b5bd6" />
                            <Text style={sv.msgText}>Searching patients...</Text>
                          </View>
                        ) : searchError ? (
                          <View style={sv.centerMsg}>
                            <Text style={sv.errorText}>⚠ Search failed. Please try again.</Text>
                          </View>
                        ) : searchResults.length === 0 && searchQuery ? (
                          <View style={sv.centerMsg}>
                            <Text style={sv.msgText}>No patients found.</Text>
                          </View>
                        ) : (
                          <FlatList
                            data={searchResults}
                            keyExtractor={(item) => item.employeeId || item.patientId || Math.random().toString()}
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={{ paddingBottom: 20, gap: 10 }}
                            renderItem={({ item: p }) => {
                              const pid = p.employeeId || p.patientId;
                              return (
                                <TouchableOpacity
                                  style={sv.searchResultCard}
                                  onPress={() => selectPatient(p)}
                                  activeOpacity={0.7}
                                >
                                  <View style={sv.searchResultAvatar}>
                                    <Text style={sv.searchResultAvatarText}>
                                      {(p.name || p.firstName || '?').charAt(0).toUpperCase()}
                                    </Text>
                                  </View>
                                  <View style={{ flex: 1, paddingLeft: 12 }}>
                                    <Text style={sv.searchResultName}>{p.name || p.firstName} {p.lastName || ''}</Text>
                                    <Text style={sv.searchResultDetails}>ID: {pid}  •  Mobile: {p.mobileNumber || p.contactNumber}</Text>
                                    <Text style={sv.searchResultDetails}>
                                      {p.gender} {p.dateOfBirth ? ` • DOB: ${new Date(p.dateOfBirth).toLocaleDateString()}` : ''}
                                    </Text>
                                  </View>
                                  <Text style={{ color: '#5b5bd6', fontSize: 24, paddingHorizontal: 8 }}>›</Text>
                                </TouchableOpacity>
                              );
                            }}
                          />
                        )}
                      </View>
                    </View>
                  )}

                  {/* ── Step 1.5: Extra Details (For Existing Patients) ── */}
                  {regStep === 'extra_details' && (
                    <>
                      <TouchableOpacity style={styles.back} onPress={() => setRegStep('search')}>
                        <Text style={styles.backText}>← Back to Search</Text>
                      </TouchableOpacity>

                      <View style={styles.field}>
                        <Text style={styles.label}>Preferred Language</Text>
                        <View style={styles.genderRow}>
                          {LANGUAGE_OPTIONS.map((lang) => (
                            <TouchableOpacity key={lang.value}
                              style={[styles.genderBtn, regLanguage === lang.value && sv.genderBtnSel]}
                              onPress={() => setRegLanguage(lang.value)}>
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
                            <TouchableOpacity key={a.key}
                              style={[styles.chip, regAllergies[a.key] && sv.chipSel]}
                              onPress={() => setRegAllergies((p) => ({ ...p, [a.key]: !p[a.key] }))}>
                              <Text style={[styles.chipText, regAllergies[a.key] && sv.chipTextSel]}>{a.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      {submitError ? (
                        <View style={styles.errorBox}>
                          <Text style={styles.errorText}>⚠ {submitError}</Text>
                        </View>
                      ) : null}

                      <TouchableOpacity
                        style={[styles.btn, registeringPatient && { opacity: 0.65 }]}
                        onPress={goToAssistantStep}
                        disabled={registeringPatient}
                        activeOpacity={0.85}
                      >
                        {registeringPatient
                          ? <ActivityIndicator color="#fff" />
                          : <Text style={styles.btnText}>Next — Choose Assistant →</Text>
                        }
                      </TouchableOpacity>
                    </>
                  )}

                  {/* ── Step 1: Details ── */}
                  {regStep === 'details' && (
                    <>
                      <TouchableOpacity style={styles.back} onPress={() => setRegStep('home')}>
                        <Text style={styles.backText}>← Back to Home</Text>
                      </TouchableOpacity>

                      <View style={styles.row}>
                        <View style={[styles.field, { flex: 2 }]}>
                          <Text style={styles.label}>Full Name *</Text>
                          <Controller control={control} name="name"
                            rules={{ required: 'Name is required', minLength: { value: 2, message: 'Minimum 2 characters required' } }}
                            render={({ field: { onChange, onBlur, value } }) => (
                              <TextInput
                                style={[styles.input, errors.name && sv.inputError]}
                                value={value}
                                onChangeText={(text) =>
                                  onChange(text.replace(/[^a-zA-Z\s]/g, '').replace(/\s+/g, ' ').replace(/^\s/, ''))
                                }
                                onBlur={onBlur}
                                placeholder="Patient name"
                                placeholderTextColor="#333"
                              />
                            )}
                          />
                          {errors.name && <Text style={sv.fieldError}>{errors.name.message}</Text>}
                        </View>

                        <View style={[styles.field, { flex: 1 }]}>
                          <Text style={styles.label}>Age *</Text>
                          <Controller control={control} name="age"
                            rules={{
                              required: 'Age is required',
                              validate: (val) => {
                                if (!val || val === '') return true;
                                const n = Number(val);
                                if (isNaN(n) || !Number.isInteger(n)) return 'Must be a number';
                                if (n < 1) return 'Min age is 1';
                                if (n > 120) return 'Max age is 120';
                                return true;
                              }
                            }}
                            render={({ field: { onChange, onBlur, value } }) => (
                              <TextInput
                                style={[styles.input, errors.age && sv.inputError]}
                                value={value}
                                onChangeText={(text) => onChange(text.replace(/[^0-9]/g, ''))}
                                onBlur={onBlur}
                                placeholder="Age"
                                placeholderTextColor="#333"
                                keyboardType="numeric"
                                maxLength={3}
                              />
                            )}
                          />
                          {errors.age && <Text style={sv.fieldError}>{errors.age.message}</Text>}
                        </View>
                      </View>

                      <View style={styles.field}>
                        <Text style={styles.label}>Mobile Number *</Text>
                        <Controller control={control} name="mobile"
                          rules={{ required: 'Mobile number is required', pattern: { value: /^[0-9]{10}$/, message: 'Mobile number must be exactly 10 digits' } }}
                          render={({ field: { onChange, onBlur, value } }) => (
                            <TextInput
                              style={[styles.input, errors.mobile && sv.inputError]}
                              value={value}
                              onChangeText={(text) => onChange(text.replace(/[^0-9]/g, '').slice(0, 10))}
                              onBlur={onBlur}
                              placeholder="10-digit mobile number"
                              placeholderTextColor="#333"
                              keyboardType="phone-pad"
                              maxLength={10}
                            />
                          )}
                        />
                        {errors.mobile && <Text style={sv.fieldError}>{errors.mobile.message}</Text>}
                      </View>

                      <View style={styles.field}>
                        <Text style={styles.label}>Gender *</Text>
                        <Controller control={control} name="gender"
                          rules={{ required: 'Please select a gender' }}
                          render={({ field: { onChange, value } }) => (
                            <View style={styles.genderRow}>
                              {['Male', 'Female', 'Others'].map((g) => (
                                <TouchableOpacity key={g}
                                  style={[styles.genderBtn, value === g && sv.genderBtnSel]}
                                  onPress={() => onChange(g)}>
                                  <Text style={[styles.genderText, value === g && sv.genderTextSel]}>{g}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                        />
                        {errors.gender && <Text style={sv.fieldError}>{errors.gender.message}</Text>}
                      </View>

                      <View style={styles.field}>
                        <Text style={styles.label}>Preferred Language</Text>
                        <View style={styles.genderRow}>
                          {LANGUAGE_OPTIONS.map((lang) => (
                            <TouchableOpacity key={lang.value}
                              style={[styles.genderBtn, regLanguage === lang.value && sv.genderBtnSel]}
                              onPress={() => setRegLanguage(lang.value)}>
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
                            <TouchableOpacity key={a.key}
                              style={[styles.chip, regAllergies[a.key] && sv.chipSel]}
                              onPress={() => setRegAllergies((p) => ({ ...p, [a.key]: !p[a.key] }))}>
                              <Text style={[styles.chipText, regAllergies[a.key] && sv.chipTextSel]}>{a.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      {submitError ? (
                        <View style={styles.errorBox}>
                          <Text style={styles.errorText}>⚠ {submitError}</Text>
                        </View>
                      ) : null}

                      <TouchableOpacity
                        style={[styles.btn, registeringPatient && { opacity: 0.65 }]}
                        onPress={goToAssistantStep}
                        disabled={registeringPatient}
                        activeOpacity={0.85}
                      >
                        {registeringPatient
                          ? <ActivityIndicator color="#fff" />
                          : <Text style={styles.btnText}>Next — Choose Assistant →</Text>
                        }
                      </TouchableOpacity>
                    </>
                  )}

                  {/* ── Step 2: Assistant ── */}
                  {regStep === 'assistant' && (
                    <>
                      <TouchableOpacity style={styles.back} onPress={() => setRegStep(isExistingPatient ? 'extra_details' : 'details')}>
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
                              <TouchableOpacity key={a.assistantId}
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

                  <View style={sv.regDisconnectRow}>
                    <TouchableOpacity style={[styles.ghostBtn, sv.disconnectBtn]}
                      onPress={handleSelfDisconnect} activeOpacity={0.85}>
                      <Text style={[styles.ghostBtnText, sv.disconnectText]}>⏏ Disconnect from VR Host</Text>
                    </TouchableOpacity>
                  </View>
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

          {networkWarning && (
            <View style={sv.networkStatusContainer}>
              <Text style={sv.unstableConnectionText}>⚠ Unstable Network Connection</Text>
            </View>
          )}

          <PeerStatusBar connected={peerConnected} rtt={peerRtt}
            reconnecting={peerReconnecting} reconnectFailed={reconnectFailed}
            onRetry={handleManualReconnect} />
          <Text style={styles.readyTitle}>Session Ready</Text>
          {patientName ? <Text style={styles.readyPatient}>Patient: {patientName}</Text> : null}
          <View style={styles.roomBadge}>
            <Text style={styles.roomLabel}>ROOM</Text>
            <Text style={styles.roomCodeText}>{roomCode}</Text>
          </View>
          <Text style={styles.readyHint}>Ask the patient to put on the VR headset, then press Begin Test.</Text>
          <TouchableOpacity
            style={[styles.bigBtn, !hasAssistantJoined && sv.btnOff]}
            onPress={startTest}
            disabled={!hasAssistantJoined}
            activeOpacity={0.85}
          >
            {!hasAssistantJoined ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.bigBtnText}>Waiting for Assistant...</Text>
              </View>
            ) : (
              <Text style={styles.bigBtnText}>▶ Begin Test on VR Device</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.ghostBtn} onPress={resetSession}>
            <Text style={styles.ghostBtnText}>← Back to Registration</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.ghostBtn, sv.disconnectBtn]} onPress={handleSelfDisconnect}>
            <Text style={[styles.ghostBtnText, sv.disconnectText]}>⏏ Disconnect from VR Host</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER E: Result PDF
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'result') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.root}>
          <WifiGuard onRestore={handleWifiRestore} />

          {networkWarning && (
            <View style={sv.networkStatusContainer}>
              <Text style={sv.unstableConnectionText}>⚠ Unstable Network Connection</Text>
            </View>
          )}

          <PeerStatusBar connected={peerConnected} rtt={peerRtt}
            reconnecting={peerReconnecting} reconnectFailed={reconnectFailed}
            onRetry={handleManualReconnect} />
          <VisionResultView patientName={patientName} roomCode={roomCode}
            resultPdfUri={resultPdfUri} onEndSession={endSession} onDisconnect={handleSelfDisconnect} />
          <View style={styles.resultDisconnectRow}>
            <TouchableOpacity style={[styles.ghostBtn, sv.disconnectBtn]} onPress={handleSelfDisconnect}>
              <Text style={[styles.ghostBtnText, sv.disconnectText]}>⏏ Disconnect from VR Host</Text>
            </TouchableOpacity>
          </View>
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
  if (isLensCheck) {
    leftActive = lensCheckEye === 'left' || lensCheckEye === 'both';
    rightActive = lensCheckEye === 'right' || lensCheckEye === 'both';
  } else if (phase === 'color') { leftActive = colorShowLeft; rightActive = colorShowRight; }
  else if (phase === 'near') { leftActive = nearShowLeft; rightActive = nearShowRight; }
  else if (phase === 'astigmatism') { leftActive = astigShowLeft; rightActive = astigShowRight; }
  else { leftActive = showLeft; rightActive = showRight; }

  const eyePanelProps = {
    panelWidth: EYE_W, panelHeight: EYE_H,
    phase, instruction, patientName, optotype, plateDots, plateIndex,
    totalPlates: TOTAL_PLATES, showFeedback: false, feedbackSeen: false,
    parallax: 0, nearOptotype, isLensCheck, lensCheckEye, contentTranslateX: 0,
    fixedPreviewSize: CONTROLLER_PREVIEW_LETTER_SIZE,
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        {testInProgress && <CustomHeader kioskLocked={testInProgress} />}
        <WifiGuard onRestore={handleWifiRestore} />

        {networkWarning && (
          <View style={sv.networkStatusContainer}>
            <Text style={sv.unstableConnectionText}>⚠ Unstable Network Connection</Text>
          </View>
        )}

        <PeerStatusBar connected={peerConnected} rtt={peerRtt}
          reconnecting={peerReconnecting} reconnectFailed={reconnectFailed}
          onRetry={handleManualReconnect} />
        <ScrollView contentContainerStyle={styles.monitorScroll}>
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

          <View style={styles.instructionBox}>
            <Text style={styles.instructionLabel}>VR Instruction</Text>
            <Text style={styles.instructionText}>{instruction}</Text>
          </View>

          <View style={styles.eyePreviewRow}>
            <View style={styles.eyePreviewCard}>
              <Text style={styles.eyePreviewLabel}>L</Text>
              <View style={[styles.eyePanelWrapper, !leftActive && { opacity: 0.35 }]}>
                <EyePanel {...eyePanelProps} side="left" active={leftActive} />
              </View>
            </View>
            <View style={styles.eyeCentreDivider} />
            <View style={styles.eyePreviewCard}>
              <Text style={styles.eyePreviewLabel}>R</Text>
              <View style={[styles.eyePanelWrapper, !rightActive && { opacity: 0.35 }]}>
                <EyePanel {...eyePanelProps} side="right" active={rightActive} />
              </View>
            </View>
          </View>

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

          {isComplete && (
            <View style={styles.completeBox}>
              <Text style={styles.completeText}>✅ Test Complete</Text>
            </View>
          )}
        </ScrollView>

        <AssistantDisconnectedModal
          visible={assistantDisconnected}
          roomCode={roomCode}
          patientName={patientName}
          onReassignSuccess={handleReassignSuccess}
          onSelfDisconnect={handleSelfDisconnect}
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
    <TouchableOpacity style={ps.bar}
      onPress={reconnectFailed ? onRetry : undefined}
      activeOpacity={reconnectFailed ? 0.7 : 1}
      disabled={!reconnectFailed}>
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

const ProfileRow = ({ label, value }) => (
  <View style={sv.profileRow}>
    <Text style={sv.profileLabel}>{label}</Text>
    <Text style={sv.profileValue}>{value || '--'}</Text>
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const ps = StyleSheet.create({
  bar: { paddingVertical: 6, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#333', backgroundColor: 'rgba(0,0,0,0.3)', flexDirection: 'row', alignItems: 'center' },
  text: { fontSize: 11, fontWeight: '500', flex: 1 },
  retryHint: { color: '#7c7cf0', fontSize: 11, fontWeight: '600', marginLeft: 8 },
});

const dm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, backgroundColor: '#111122', borderWidth: 1, borderColor: 'rgba(249,168,37,0.35)', borderRadius: 20, padding: 24, alignItems: 'center', gap: 14, shadowColor: '#f9a825', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 12 },
  iconRing: { width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: '#f9a825', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(249,168,37,0.10)' },
  iconText: { fontSize: 28, color: '#f9a825' },
  title: { fontSize: 17, fontWeight: '700', color: '#fff', textAlign: 'center' },
  sub: { fontSize: 12, color: '#aaa', textAlign: 'center', lineHeight: 18 },
  countdownBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 16, backgroundColor: 'rgba(249,168,37,0.08)', borderWidth: 1, borderColor: 'rgba(249,168,37,0.25)', borderRadius: 100 },
  countdownLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, color: '#f9a825', textTransform: 'uppercase' },
  countdownValue: { fontSize: 15, fontWeight: '700', color: '#f9a825', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
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
  errorBox: { width: '100%', backgroundColor: 'rgba(204,51,51,0.12)', borderWidth: 1, borderColor: 'rgba(204,51,51,0.3)', borderRadius: 10, padding: 10 },
  errorText: { color: '#ff6666', fontSize: 12, textAlign: 'center' },
  reassignBtn: { width: '100%', paddingVertical: 13, backgroundColor: '#f9a825', borderRadius: 100, alignItems: 'center', marginTop: 2, shadowColor: '#f9a825', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 6 },
  reassignBtnOff: { opacity: 0.35, shadowOpacity: 0 },
  reassignBtnText: { color: '#000', fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },
  patientFooter: { color: '#444', fontSize: 10, textAlign: 'center', marginTop: 2 },
  selfDisconnectBtn: { marginTop: 2, paddingVertical: 7, paddingHorizontal: 20, borderRadius: 100, borderWidth: 1, borderColor: 'rgba(229,57,53,0.35)', backgroundColor: 'rgba(229,57,53,0.06)' },
  selfDisconnectText: { color: '#ef5350', fontSize: 12, fontWeight: '600' },
});

const auth = StyleSheet.create({
  root: { flex: 1, backgroundColor: appColor },
  logoBox: { width: 150, height: 150, borderRadius: 75, backgroundColor: 'white', alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginVertical: 40 },
  logo: { width: '65%', height: '65%', resizeMode: 'contain' },
  card: { backgroundColor: 'white', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 28, alignItems: 'center', gap: 12, justifyContent: 'flex-end' },
  title: { fontSize: 26, fontWeight: 'bold', color: appColor },
  subtitle: { fontSize: 15, color: 'grey', marginBottom: 6 },
  input: { borderRadius: 100, color: appColor, paddingVertical: 14, paddingHorizontal: 20, width: '100%', backgroundColor: 'rgb(220,220,220)' },
  passRow: { flexDirection: 'row', alignItems: 'center', width: '100%', gap: 8 },
  eyeBtn: { paddingHorizontal: 8 },
  btn: { borderRadius: 100, width: '100%', paddingVertical: 14, alignItems: 'center', backgroundColor: appColor, marginTop: 4 },
  btnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  scrollContent: { flexGrow: 1, justifyContent: 'flex-end' },
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
  back: { alignSelf: 'flex-start', marginBottom: 12 },
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
  resultDisconnectRow: { paddingHorizontal: 24, paddingBottom: 16, alignItems: 'center' },
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
  disconnectBtn: { marginTop: 4, borderWidth: 1, borderColor: 'rgba(229,57,53,0.35)', borderRadius: 100, paddingVertical: 7, paddingHorizontal: 20, backgroundColor: 'rgba(229,57,53,0.06)' },
  disconnectText: { color: '#ef5350', textDecorationLine: 'none', fontSize: 13 },
  regDisconnectRow: { alignItems: 'center', marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(229,57,53,0.12)' },
  inputError: { borderColor: 'rgba(239,83,80,0.7)', backgroundColor: 'rgba(239,83,80,0.05)' },
  fieldError: { color: '#ef5350', fontSize: 11, marginTop: 2, marginLeft: 2 },

  // Dashboard / Home Styles
  homeWrapper: { flex: 1, gap: 24 },
  profileCard: { backgroundColor: 'rgba(91,91,214,0.06)', borderWidth: 1, borderColor: 'rgba(91,91,214,0.2)', borderRadius: 16, padding: 20 },
  profileHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', paddingBottom: 12 },
  profileTitle: { color: '#e8e8f0', fontSize: 16, fontWeight: '600' },
  logoutBtn: { backgroundColor: 'rgba(229,57,53,0.1)', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 100, borderWidth: 1, borderColor: 'rgba(229,57,53,0.3)' },
  logoutBtnText: { color: '#ef5350', fontSize: 12, fontWeight: '600' },
  profileData: { gap: 10 },
  profileRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  profileLabel: { color: '#889', fontSize: 12, fontWeight: '500' },
  profileValue: { color: '#c0c0e0', fontSize: 13, fontWeight: '600', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  actionPrompt: { color: '#889', fontSize: 13, textAlign: 'center', marginTop: 8 },
  actionRow: { flexDirection: 'row', gap: 12 },
  actionBtn: { flex: 1, backgroundColor: '#5b5bd6', paddingVertical: 14, borderRadius: 12, alignItems: 'center', shadowColor: '#5b5bd6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
  actionBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  actionBtnGhost: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(124,124,240,0.3)', shadowOpacity: 0, elevation: 0 },
  actionBtnGhostText: { color: '#a0a0f0', fontSize: 14, fontWeight: '600' },

  // Search Step Styles
  searchBarRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchInput: { flex: 1, backgroundColor: '#0d0d1a', borderWidth: 1, borderColor: '#2a2a40', borderRadius: 10, color: '#e8e8f0', fontSize: 14, paddingVertical: 12, paddingHorizontal: 16 },
  searchBtn: { backgroundColor: '#5b5bd6', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  searchBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  searchErrorText: { color: '#ef5350', fontSize: 13, marginTop: 12, textAlign: 'center' },
  searchResultCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: '#1e1e30', borderRadius: 12, padding: 12, marginBottom: 10 },
  searchResultAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(91,91,214,0.15)', alignItems: 'center', justifyContent: 'center' },
  searchResultAvatarText: { color: '#a0a0f0', fontSize: 18, fontWeight: '700' },
  searchResultName: { color: '#e8e8f0', fontSize: 15, fontWeight: '600', marginBottom: 2 },
  searchResultDetails: { color: '#889', fontSize: 11, marginBottom: 2 },
  centerMsg: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 12 },
  msgText: { color: '#889', fontSize: 14 },
  networkStatusContainer: {
    backgroundColor: 'rgba(229,57,53,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(229,57,53,0.3)',
    borderRadius: 8,
    padding: 10,
    marginHorizontal: 20,
    marginTop: 10,
    alignItems: 'center',
    marginBottom: -10, // offsets the space before the card
  },
  unstableConnectionText: { color: '#ef5350', fontSize: 13, fontWeight: '600' },
});