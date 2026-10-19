package com.youhan.one;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.telephony.PhoneStateListener;
import android.telephony.TelephonyCallback;
import android.telephony.TelephonyManager;
import androidx.annotation.RequiresApi;
import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONObject;

/**
 * CallWatch (M9-09): tells the page when a call the agent placed from the app has ended, so the
 * page can log it on the lead.
 *
 * start({ key }) arms it for the next outgoing call and answers { armed }. One "callEnded" event
 * follows, carrying the key: when that call ends, or with timedOut after 60 seconds with no call.
 * A call that rings in first is not the agent's and is let pass.
 *
 * Android tells an ordinary app the call state only (idle, ringing, off hook): never the number,
 * never the moment an outgoing call is answered (that is READ_PRECISE_PHONE_STATE, for system
 * apps). So connected and connectedAt are null here and durationSeconds is the time off hook,
 * ringing included; the page decides what that means.
 *
 * READ_PHONE_STATE only. Never READ_CALL_LOG, PROCESS_OUTGOING_CALLS, CALL_PHONE or the dialler
 * role, which Play restricts. It is asked for once, after a rationale, the first time an agent
 * taps Call; refused, start answers armed: false and the page logs by hand as before.
 */
@CapacitorPlugin(
    name = "CallWatch",
    permissions = @Permission(strings = { Manifest.permission.READ_PHONE_STATE }, alias = CallWatchPlugin.PHONE)
)
public class CallWatchPlugin extends Plugin {

    static final String PHONE = "phone";
    private static final long ARMED_FOR_MS = 60_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable timeout = () -> finish(true);
    /** The armed call's key; null when nothing is armed. Touched on the main thread only. */
    private String key;
    /** Idle seen since arming: the next off hook is a call being placed, not one answered. */
    private boolean idle;
    /** When the call went off hook; 0 until then. */
    private long startedAt;
    /** A TelephonyCallback (API 31+) or a PhoneStateListener. */
    private Object listener;

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState(PHONE) == PermissionState.GRANTED) {
            arm(call);
            return;
        }
        SharedPreferences prefs = getContext().getSharedPreferences("callwatch", Context.MODE_PRIVATE);
        if (prefs.getBoolean("asked", false)) {
            unarmed(call);
            return;
        }
        prefs.edit().putBoolean("asked", true).apply();
        getBridge()
            .executeOnMainThread(() ->
                new AlertDialog.Builder(getActivity())
                    .setTitle("Log your calls automatically")
                    .setMessage(
                        "YOUHAN ONE can log a call you place from a lead by itself, with when it started and how long it lasted. " +
                            "For that it needs to see when the phone is on a call. Android calls this \"make and manage phone calls\": " +
                            "YOUHAN ONE never places, manages or records a call, and never reads your call history or the numbers you call."
                    )
                    .setPositiveButton("Continue", (dialog, which) -> requestPermissionForAlias(PHONE, call, "onPermission"))
                    .setNegativeButton("Not now", (dialog, which) -> unarmed(call))
                    .setOnCancelListener((dialog) -> unarmed(call))
                    .show()
            );
    }

    @PermissionCallback
    private void onPermission(PluginCall call) {
        if (getPermissionState(PHONE) == PermissionState.GRANTED) arm(call);
        else unarmed(call);
    }

    private void unarmed(PluginCall call) {
        call.resolve(new JSObject().put("armed", false));
    }

    private void arm(PluginCall call) {
        String next = call.getString("key", "");
        getBridge()
            .executeOnMainThread(() -> {
                finish(true); // a call still armed is replaced, and its page told
                key = next;
                idle = false;
                startedAt = 0;
                TelephonyManager phone = getContext().getSystemService(TelephonyManager.class);
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        CallState callback = new CallState();
                        listener = callback;
                        phone.registerTelephonyCallback(getContext().getMainExecutor(), callback);
                    } else {
                        PhoneStateListener legacy = new PhoneStateListener() {
                            @Override
                            public void onCallStateChanged(int state, String number) {
                                onState(state);
                            }
                        };
                        listener = legacy;
                        phone.listen(legacy, PhoneStateListener.LISTEN_CALL_STATE);
                    }
                } catch (SecurityException e) {
                    // The permission was withdrawn between the check and here.
                    listener = null;
                    key = null;
                    unarmed(call);
                    return;
                }
                main.postDelayed(timeout, ARMED_FOR_MS);
                call.resolve(new JSObject().put("armed", true));
            });
    }

    /** Both listeners report the current state on registering, then every change. */
    private void onState(int state) {
        if (key == null) return;
        if (startedAt == 0) {
            if (state == TelephonyManager.CALL_STATE_OFFHOOK && idle) {
                startedAt = System.currentTimeMillis();
                main.removeCallbacks(timeout);
            }
            idle = state == TelephonyManager.CALL_STATE_IDLE;
        } else if (state == TelephonyManager.CALL_STATE_IDLE) {
            finish(false);
        }
    }

    private void finish(boolean timedOut) {
        if (key == null) return;
        long now = System.currentTimeMillis();
        JSObject result = new JSObject()
            .put("key", key)
            .put("timedOut", timedOut)
            .put("startedAt", startedAt == 0 ? JSONObject.NULL : (Object) startedAt)
            .put("connectedAt", JSONObject.NULL)
            .put("endedAt", now)
            .put("durationSeconds", startedAt == 0 ? 0 : (now - startedAt) / 1000)
            .put("connected", JSONObject.NULL);
        disarm();
        notifyListeners("callEnded", result);
    }

    private void disarm() {
        main.removeCallbacks(timeout);
        key = null;
        if (listener == null) return;
        TelephonyManager phone = getContext().getSystemService(TelephonyManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) phone.unregisterTelephonyCallback((TelephonyCallback) listener);
        else phone.listen((PhoneStateListener) listener, PhoneStateListener.LISTEN_NONE);
        listener = null;
    }

    @Override
    protected void handleOnDestroy() {
        main.post(this::disarm);
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private class CallState extends TelephonyCallback implements TelephonyCallback.CallStateListener {

        @Override
        public void onCallStateChanged(int state) {
            onState(state);
        }
    }
}
