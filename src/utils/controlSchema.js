/**
 * Control message schema — sent over WebRTC DataChannel.
 *
 * nx, ny = normalized 0.0–1.0 coordinates relative to sender screen.
 * The AccessibilityService multiplies by real screen dimensions.
 *
 * LIMITATION: Only actions supported by Android AccessibilityService API
 * are implemented. Root-only or system-only APIs are NOT used.
 */

export const makeTap = (nx, ny) =>
    ({ type: 'tap', nx, ny, ts: Date.now() });

export const makeLongPress = (nx, ny, durationMs = 700) =>
    ({ type: 'long_press', nx, ny, durationMs, ts: Date.now() });

export const makeSwipe = (nx, ny, ex, ey, durationMs = 300) =>
    ({ type: 'swipe', nx, ny, ex, ey, durationMs, ts: Date.now() });

export const makeScroll = (nx, ny, direction, velocity = 1.0) =>
    ({ type: 'scroll', nx, ny, direction, velocity, ts: Date.now() });
// direction: 'up' | 'down' | 'left' | 'right'

export const makeKeyText = (text) =>
    ({ type: 'key_text', text, ts: Date.now() });

export const makeGlobal = (action) =>
    ({ type: action, ts: Date.now() });
// action: 'back' | 'home' | 'recents' | 'notifications' | 'quick_settings'