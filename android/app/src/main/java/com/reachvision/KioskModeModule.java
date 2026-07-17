package com.reachvision;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.widget.Toast;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Callback;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class KioskModeModule extends ReactContextBaseJavaModule {
    private static ReactApplicationContext reactApplicationContext;

    public KioskModeModule(ReactApplicationContext context){
        super(context);
        reactApplicationContext = context;
    }

    @NonNull
    @Override
    public String getName() {
        return "KioskMode";
    }

    @ReactMethod
    public void startKioskMode(){
        Activity activity = getCurrentActivity();

        // Null check added here to prevent background crash
        if (activity != null) {
            try {
                activity.startLockTask();
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }

    @ReactMethod
    public void stopKioskMode(){
        Activity activity = getCurrentActivity();

        // Null check added here to prevent background crash
        if (activity != null) {
            try {
                activity.stopLockTask();
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }

    @ReactMethod
    public void isKioskModeEnabled(Callback callback) {
        Activity activity = getCurrentActivity();
        if (activity != null) {
            ActivityManager activityManager = (ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE);
            int lockTaskMode = activityManager.getLockTaskModeState();

            // Lock task states: LOCK_TASK_MODE_NONE, LOCK_TASK_MODE_LOCKED, or LOCK_TASK_MODE_PINNED
            boolean isKioskMode = (lockTaskMode == ActivityManager.LOCK_TASK_MODE_LOCKED ||
                    lockTaskMode == ActivityManager.LOCK_TASK_MODE_PINNED);

            callback.invoke(isKioskMode);
        } else {
            // Safe fallback if activity is null when this is checked
            callback.invoke(false);
        }
    }
}