/**
 * SplitVRLayout.js v6.0 — Assistant Disconnected Overlay
 *
 * Changes from v5.0:
 * - ADD: `assistantDisconnected` prop
 * - ADD: DisconnectedOverlay component — full-screen stereo warning rendered
 *        over BOTH eye panels in the cardboard split view. Matches the Angular
 *        modal backdrop shown to the patient on assistant_disconnected.
 *        Pulsing ⚠ icon, bilingual label shown in both left and right halves
 *        so it is readable through the VR cardboard lens.
 * - ADD: Overlay auto-removes (unmounts) when assistantDisconnected → false
 *        (i.e., when assistant_joined arrives and patient resumes the test).
 */

import React, { memo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, Animated } from 'react-native';
import EyePanel from './EyePanel';
import calibrationService from '../services/calibrationService';

// ── AudioDot (unchanged from v5.0) ───────────────────────────────────────────
function AudioDot({ rtcState }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (rtcState.isInitialising || (rtcState.isConnected && !rtcState.isMuted)) {
      const duration = rtcState.isInitialising ? 1000 : 1400;
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.5, duration: duration / 2, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,   duration: duration / 2, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [rtcState.isInitialising, rtcState.isConnected, rtcState.isMuted]);

  let dotColor = '#555';
  if (rtcState.isInitialising)                        dotColor = '#f9a825';
  else if (rtcState.isConnected && !rtcState.isMuted) dotColor = '#4caf50';
  else if (rtcState.hasError)                         dotColor = '#e53935';

  return (
    <View style={aud.badge} pointerEvents="none">
      <Animated.View
        style={[
          aud.dot,
          {
            backgroundColor: dotColor,
            opacity: (rtcState.isInitialising || (rtcState.isConnected && !rtcState.isMuted))
              ? pulseAnim
              : 1,
          },
        ]}
      />
    </View>
  );
}

// ── NEW: DisconnectedOverlay ─────────────────────────────────────────────────
// Rendered over the full split-screen (both eyes) when assistant_disconnected
// fires. Each half mirrors the other so the patient sees the message through
// either cardboard lens. Cleared automatically when assistantDisconnected → false.
function DisconnectedOverlay() {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 650, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const HalfPanel = () => (
    <View style={dis.half}>
      <Animated.View style={[dis.iconRing, { opacity: pulse }]}>
        <Text style={dis.iconText}>⚠</Text>
      </Animated.View>
      <Text style={dis.title}>Assistant{'\n'}Disconnected</Text>
      <Text style={dis.sub}>Please wait…{'\n'}Reconnecting</Text>
      <View style={dis.dots}>
        {[0, 1, 2].map((i) => (
          <Animated.View
            key={i}
            style={[
              dis.dot,
              {
                opacity: pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [i === 0 ? 0.2 : i === 1 ? 0.5 : 1, i === 0 ? 1 : i === 1 ? 0.5 : 0.2],
                }),
              },
            ]}
          />
        ))}
      </View>
    </View>
  );

  return (
    <View style={dis.overlay} pointerEvents="none">
      <HalfPanel />
      <View style={dis.divider} />
      <HalfPanel />
    </View>
  );
}

// ── SplitVRLayout ────────────────────────────────────────────────────────────
function SplitVRLayout({
  phase,
  instruction,
  patientName,
  optotype,
  isComplete,
  showLeft, showRight,
  colorShowLeft, colorShowRight,
  nearShowLeft, nearShowRight,
  astigShowLeft, astigShowRight,
  plateDots, plateIndex, totalPlates,
  showFeedback, feedbackSeen,
  parallax,
  rtcState,
  onCloseSession,
  nearOptotype,
  isLensCheck,
  lensCheckEye,
  assistantDisconnected, // ← NEW v6.0
}) {
  const dim     = Dimensions.get('window');
  const screenW = Math.max(dim.width, dim.height);
  const screenH = Math.min(dim.width, dim.height);
  const panelW  = (screenW - 2) / 2;
  const panelH  = screenH;

  // ── Eye visibility per phase ───────────────────────────────────────────────
  const leftActive = (() => {
    if (isComplete)  return true;
    if (isLensCheck) return showLeft;
    switch (phase) {
      case 'acuity':      return showLeft;
      case 'color':       return colorShowLeft;
      case 'near':        return nearShowLeft;
      case 'astigmatism': return astigShowLeft;
      default:            return true;
    }
  })();

  const rightActive = (() => {
    if (isComplete)  return true;
    if (isLensCheck) return showRight;
    switch (phase) {
      case 'acuity':      return showRight;
      case 'color':       return colorShowRight;
      case 'near':        return nearShowRight;
      case 'astigmatism': return astigShowRight;
      default:            return true;
    }
  })();

  const isBothEyesActive     = leftActive && rightActive && !isComplete;
  const convergenceShift     = isBothEyesActive ? Math.min(panelW * 0.03, 12) : 0;
  const leftContentTranslateX  =  isBothEyesActive ? convergenceShift  : 0;
  const rightContentTranslateX = isBothEyesActive  ? -convergenceShift : 0;

  const layerStyle = (layer) => {
    if (!parallax) return {};
    const { x = 0, y = 0 } = parallax[layer] ?? {};
    return { transform: [{ translateX: x }, { translateY: y }] };
  };

  return (
    <View style={styles.vrRoot}>
      <View style={styles.vrScreen}>

        {/* Left eye panel */}
        <EyePanel
          panelWidth={panelW} panelHeight={panelH}
          side="left" active={leftActive}
          phase={isComplete ? 'complete' : phase}
          instruction={instruction} patientName={patientName}
          optotype={optotype} plateDots={plateDots}
          plateIndex={plateIndex} totalPlates={totalPlates}
          showFeedback={showFeedback} feedbackSeen={feedbackSeen}
          parallax={parallax} onCloseSession={onCloseSession}
          nearOptotype={nearOptotype}
          isLensCheck={isLensCheck} lensCheckEye={lensCheckEye}
          contentTranslateX={leftContentTranslateX}
        />

        {/* Centre divider */}
        <View style={styles.vrDivider} />

        {/* Right eye panel */}
        <EyePanel
          panelWidth={panelW} panelHeight={panelH}
          side="right" active={rightActive}
          phase={isComplete ? 'complete' : phase}
          instruction={instruction} patientName={patientName}
          optotype={optotype} plateDots={plateDots}
          plateIndex={plateIndex} totalPlates={totalPlates}
          showFeedback={showFeedback} feedbackSeen={feedbackSeen}
          parallax={parallax} onCloseSession={onCloseSession}
          nearOptotype={nearOptotype}
          isLensCheck={isLensCheck} lensCheckEye={lensCheckEye}
          contentTranslateX={rightContentTranslateX}
        />

        {/* Audio dot */}
        {rtcState && <AudioDot rtcState={rtcState} />}
      </View>

      {/* ── v6.0: Disconnected overlay — mounts/unmounts reactively ── */}
      {assistantDisconnected && <DisconnectedOverlay />}
    </View>
  );
}

// ── Base styles ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  vrRoot:    { flex: 1, backgroundColor: '#000000', overflow: 'hidden' },
  vrScreen:  { flex: 1, flexDirection: 'row', alignItems: 'stretch' },
  vrDivider: { width: 2, backgroundColor: '#1a1a1a', flexShrink: 0, zIndex: 10 },
});

const aud = StyleSheet.create({
  badge: {
    position: 'absolute', top: 12, alignSelf: 'center',
    left: '50%', marginLeft: -4, zIndex: 30,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

// ── Disconnected overlay styles ───────────────────────────────────────────────
const dis = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.84)',
    zIndex: 100,
  },
  half: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  divider: { width: 2, backgroundColor: '#1a1a1a' },
  iconRing: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 2, borderColor: '#f9a825',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(249,168,37,0.10)',
  },
  iconText: { fontSize: 30, color: '#f9a825' },
  title: {
    fontSize: 17, fontWeight: '700', color: '#fff',
    textAlign: 'center', lineHeight: 24,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  sub: {
    fontSize: 12, color: '#aaa', textAlign: 'center', lineHeight: 18,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  dots: { flexDirection: 'row', gap: 8, marginTop: 4 },
  dot:  { width: 7, height: 7, borderRadius: 4, backgroundColor: '#f9a825' },
});

export default memo(SplitVRLayout);
