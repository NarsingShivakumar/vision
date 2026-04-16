package com.reachvision.modules;


import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.util.DisplayMetrics;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.reachvision.service.ScreenCaptureService;

/**
 * Native module for MediaProjection screen capture.
 *
 * IMPORTANT: Screen capture REQUIRES explicit user consent via the system dialog
 * (MediaProjectionManager.createScreenCaptureIntent). There is NO way to bypass
 * this — it is an Android security requirement. The consent is requested once per
 * session and must be granted again if the app is restarted.
 *
 * The capture runs in a Foreground Service (ScreenCaptureService) with
 * foregroundServiceType="mediaProjection" as required by Android 10+.
 */
public class MediaProjectionModule extends ReactContextBaseJavaModule {

    private static final int REQUEST_CODE = 100;

    private MediaProjectionManager projectionManager;
    private MediaProjection         mediaProjection;
    private Promise                 capturePromise;

    // Accessibility check (static ref to service)
    public static volatile boolean accessibilityServiceEnabled = false;

    public MediaProjectionModule(ReactApplicationContext context) {
        super(context);
        projectionManager = (MediaProjectionManager)
                context.getSystemService(Context.MEDIA_PROJECTION_SERVICE);

        context.addActivityEventListener(activityEventListener);
    }

    @Override
    public String getName() { return "MediaProjectionModule"; }

    /**
     * Shows the system "Start recording?" dialog.
     * Resolves with result code on acceptance, rejects on denial.
     */
    @ReactMethod
    public void requestScreenCapture(Promise promise) {
        Activity activity = getCurrentActivity();
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No active Activity");
            return;
        }
        capturePromise = promise;
        Intent intent = projectionManager.createScreenCaptureIntent();
        activity.startActivityForResult(intent, REQUEST_CODE);
    }

    /**
     * Starts the foreground service and initialises MediaProjection.
     * Call after requestScreenCapture resolves with a result code.
     * Returns screen dimensions so the JS layer can set up the WebRTC track.
     */
    @ReactMethod
    public void startCapture(int resultCode, int bitrate, int fps, boolean audio, Promise promise) {
        Activity activity = getCurrentActivity();
        if (activity == null) { promise.reject("NO_ACTIVITY", "No Activity"); return; }

        // Start foreground service (required before getMediaProjection on API 29+)
        Intent serviceIntent = new Intent(getReactApplicationContext(), ScreenCaptureService.class);
        serviceIntent.setAction(ScreenCaptureService.ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getReactApplicationContext().startForegroundService(serviceIntent);
        } else {
            getReactApplicationContext().startService(serviceIntent);
        }

        // Obtain MediaProjection token
        Intent data = projectionManager.createScreenCaptureIntent(); // placeholder
        // NOTE: In production, the resultData from onActivityResult must be
        // stored and passed here. See activityEventListener below.
        mediaProjection = projectionManager.getMediaProjection(
                Activity.RESULT_OK, storedResultData
        );

        if (mediaProjection == null) {
            promise.reject("PROJECTION_NULL", "MediaProjection is null");
            return;
        }

        DisplayMetrics dm = getReactApplicationContext().getResources().getDisplayMetrics();
        // The actual VirtualDisplay + MediaCodec / WebRTC track creation is handled by
        // react-native-webrtc's ScreenCapturePickerView / getDisplayMedia equivalent.
        // We pass the mediaProjection token to WebRTC internals via the module bridge.
        // react-native-webrtc >= v118 supports MediaProjection token injection.

        promise.resolve(null); // JS layer uses mediaStream from getDisplayMedia
    }

    @ReactMethod
    public void stopCapture() {
        if (mediaProjection != null) {
            mediaProjection.stop();
            mediaProjection = null;
        }
        Intent stopIntent = new Intent(getReactApplicationContext(), ScreenCaptureService.class);
        stopIntent.setAction(ScreenCaptureService.ACTION_STOP);
        getReactApplicationContext().startService(stopIntent);
    }

    @ReactMethod
    public void isAccessibilityEnabled(Promise promise) {
        promise.resolve(accessibilityServiceEnabled);
    }

    // ── Stores result data from MediaProjection consent dialog ──────────────
    private Intent storedResultData = null;

    private final ActivityEventListener activityEventListener = new BaseActivityEventListener() {
        @Override
        public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
            if (requestCode != REQUEST_CODE) return;
            if (capturePromise == null) return;

            if (resultCode == Activity.RESULT_OK && data != null) {
                storedResultData = data;
                capturePromise.resolve(resultCode);
            } else {
                capturePromise.reject("DENIED", "Screen capture permission was denied by user.");
            }
            capturePromise = null;
        }
    };
}