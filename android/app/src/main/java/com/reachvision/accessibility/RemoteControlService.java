package com.reachvision.accessibility;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.graphics.Point;
import android.os.Build;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;

import com.reachvision.modules.MediaProjectionModule;

import org.json.JSONObject;

/**
 * AccessibilityService for remote control of the host device.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTANT LIMITATION:
 * Third-party Android apps CANNOT perform unrestricted device control.
 * This service uses only public AccessibilityService APIs:
 *   - dispatchGesture() for tap, long press, swipe, scroll
 *   - performGlobalAction() for Back, Home, Recents, Notifications, Quick Settings
 *
 * Actions NOT possible without root/system privileges:
 *   - Unlocking a locked screen
 *   - Installing/uninstalling apps silently
 *   - Bypassing system permission dialogs
 *   - Controlling other accessibility services
 *   - Any shell/adb-level commands
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Safeguards:
 *   - Consent must be granted in JS layer before any command is accepted.
 *   - Commands are rate-limited to prevent accidental gesture loops.
 *   - A static flag (commandsEnabled) gates ALL gesture execution.
 */
public class RemoteControlService extends AccessibilityService {

    private static final String TAG              = "RemoteCtrl";
    private static final long   RATE_LIMIT_MS    = 50; // max 20 gestures/sec

    // Static references for cross-module communication
    public static volatile RemoteControlService instance        = null;
    public static volatile boolean              commandsEnabled = false;

    private long lastCommandTime = 0;
    private int  screenWidth     = 0;
    private int  screenHeight    = 0;

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        MediaProjectionModule.accessibilityServiceEnabled = true;
        refreshScreenDimensions();
        Log.i(TAG, "RemoteControlService connected. screenW=" + screenWidth + " screenH=" + screenHeight);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Not used — we only perform actions, not observe UI events
    }

    @Override
    public void onInterrupt() {
        Log.w(TAG, "RemoteControlService interrupted");
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        instance = null;
        commandsEnabled = false;
        MediaProjectionModule.accessibilityServiceEnabled = false;
        Log.i(TAG, "RemoteControlService destroyed");
    }

    // ── Public command entry point ────────────────────────────────────────────

    /**
     * Execute a control command received from the WebRTC data channel.
     * Called from the JS bridge (via a native module) after consent is granted.
     *
     * @param jsonCmd JSON string matching the controlSchema.js format
     */
    public void executeCommand(String jsonCmd) {
        if (!commandsEnabled) {
            Log.w(TAG, "Commands not enabled — ignoring");
            return;
        }

        // Rate limit
        long now = System.currentTimeMillis();
        if (now - lastCommandTime < RATE_LIMIT_MS) return;
        lastCommandTime = now;

        try {
            JSONObject cmd = new JSONObject(jsonCmd);
            String type    = cmd.getString("type");

            switch (type) {
                case "tap":
                    performTap(
                            cmd.getDouble("nx"), cmd.getDouble("ny")
                    );
                    break;

                case "long_press":
                    performLongPress(
                            cmd.getDouble("nx"), cmd.getDouble("ny"),
                            cmd.optLong("durationMs", 700)
                    );
                    break;

                case "swipe":
                    performSwipe(
                            cmd.getDouble("nx"),  cmd.getDouble("ny"),
                            cmd.getDouble("ex"),  cmd.getDouble("ey"),
                            cmd.optLong("durationMs", 300)
                    );
                    break;

                case "scroll":
                    performScroll(
                            cmd.getDouble("nx"), cmd.getDouble("ny"),
                            cmd.getString("direction"),
                            cmd.optDouble("velocity", 1.0)
                    );
                    break;

                case "key_text":
                    // AccessibilityService cannot directly type into arbitrary fields.
                    // We use performAction(ACTION_SET_TEXT) on focused node, which works
                    // only when a text field is already focused on the host screen.
                    performTextEntry(cmd.getString("text"));
                    break;

                case "back":
                    performGlobalAction(GLOBAL_ACTION_BACK);
                    break;
                case "home":
                    performGlobalAction(GLOBAL_ACTION_HOME);
                    break;
                case "recents":
                    performGlobalAction(GLOBAL_ACTION_RECENTS);
                    break;
                case "notifications":
                    performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
                    break;
                case "quick_settings":
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS);
                    }
                    break;
                default:
                    Log.d(TAG, "Unknown command type: " + type);
            }
        } catch (Exception e) {
            Log.e(TAG, "executeCommand error: " + e.getMessage());
        }
    }

    // ── Gesture helpers ───────────────────────────────────────────────────────

    private void performTap(double nx, double ny) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return;
        refreshScreenDimensions();
        float x = (float)(nx * screenWidth);
        float y = (float)(ny * screenHeight);

        Path path = new Path();
        path.moveTo(x, y);

        GestureDescription.StrokeDescription stroke =
                new GestureDescription.StrokeDescription(path, 0, 100);
        GestureDescription gesture = new GestureDescription.Builder()
                .addStroke(stroke).build();

        dispatchGesture(gesture, null, null);
        Log.d(TAG, "Tap at (" + x + ", " + y + ")");
    }

    private void performLongPress(double nx, double ny, long durationMs) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return;
        refreshScreenDimensions();
        float x = (float)(nx * screenWidth);
        float y = (float)(ny * screenHeight);

        Path path = new Path();
        path.moveTo(x, y);

        GestureDescription.StrokeDescription stroke =
                new GestureDescription.StrokeDescription(path, 0, Math.max(durationMs, 600));
        dispatchGesture(
                new GestureDescription.Builder().addStroke(stroke).build(),
                null, null
        );
    }

    private void performSwipe(double nx, double ny, double ex, double ey, long durationMs) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return;
        refreshScreenDimensions();
        float sx = (float)(nx * screenWidth);
        float sy = (float)(ny * screenHeight);
        float dx = (float)(ex * screenWidth);
        float dy = (float)(ey * screenHeight);

        Path path = new Path();
        path.moveTo(sx, sy);
        path.lineTo(dx, dy);

        GestureDescription.StrokeDescription stroke =
                new GestureDescription.StrokeDescription(path, 0, durationMs);
        dispatchGesture(
                new GestureDescription.Builder().addStroke(stroke).build(),
                null, null
        );
    }

    private void performScroll(double nx, double ny, String direction, double velocity) {
        // Scroll is implemented as a short swipe in the given direction
        double dist = 0.3 * velocity;
        double ex = nx, ey = ny;
        switch (direction) {
            case "up":    ey = Math.max(0, ny - dist); break;
            case "down":  ey = Math.min(1, ny + dist); break;
            case "left":  ex = Math.max(0, nx - dist); break;
            case "right": ex = Math.min(1, nx + dist); break;
        }
        performSwipe(nx, ny, ex, ey, 200);
    }

    private void performTextEntry(String text) {
        // Find focused editable node and set its text
        android.view.accessibility.AccessibilityNodeInfo focused =
                getRootInActiveWindow();
        if (focused == null) return;

        android.os.Bundle args = new android.os.Bundle();
        args.putCharSequence(
                android.view.accessibility.AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                text
        );
        focused.performAction(
                android.view.accessibility.AccessibilityNodeInfo.ACTION_SET_TEXT, args
        );
    }

    private void refreshScreenDimensions() {
        try {
            WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            if (wm == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Rect bounds = wm.getCurrentWindowMetrics().getBounds();
                screenWidth  = bounds.width();
                screenHeight = bounds.height();
            } else {
                DisplayMetrics dm = new DisplayMetrics();
                wm.getDefaultDisplay().getRealMetrics(dm);
                screenWidth  = dm.widthPixels;
                screenHeight = dm.heightPixels;
            }
        } catch (Exception e) {
            Log.w(TAG, "refreshScreenDimensions error: " + e.getMessage());
        }
    }
}
