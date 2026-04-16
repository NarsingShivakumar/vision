// ScreenCast — Offline LAN Screen Sharing
// IMPORTANT: This app uses only legal Android APIs.
// "Full device control" is NOT possible for third-party apps.
// Control is limited to AccessibilityService (dispatchGesture, performGlobalAction).

export const SIGNAL_PORT = 3838;
export const DISCOVERY_PORT = 5354;

export const MSG = {
    JOIN_ROOM: 'join_room',
    OFFER: 'offer',
    ANSWER: 'answer',
    ICE_CANDIDATE: 'ice_candidate',
    ROOM_JOINED: 'room_joined',
    PEER_JOINED: 'peer_joined',
    PEER_LEFT: 'peer_left',
    ERROR: 'error',
    CTRL_CONSENT_REQUEST: 'ctrl_consent_request',
    CTRL_CONSENT_ACK: 'ctrl_consent_ack',
};

export const ROLE = { HOST: 'host', CONTROLLER: 'controller' };

export const CTRL = {
    TAP: 'tap',
    LONG_PRESS: 'long_press',
    SWIPE: 'swipe',
    SCROLL: 'scroll',
    KEY_TEXT: 'key_text',
    BACK: 'back',
    HOME: 'home',
    RECENTS: 'recents',
    NOTIFICATIONS: 'notifications',
    QUICK_SETTINGS: 'quick_settings',
    STOP: 'stop_session',
};