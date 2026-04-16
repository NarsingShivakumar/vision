package com.reachvision.modules;


import android.util.Log;

import com.facebook.react.bridge.Callback;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * UDP broadcast-based LAN discovery.
 *
 * Advertising device sends JSON beacon to 255.255.255.255:<port> every 2 seconds.
 * Scanning device listens on <port> and fires the callback for each unique peer found.
 *
 * Beacon format (JSON):
 *   { "roomCode": "AB3F72", "deviceName": "Pixel 7", "ip": "192.168.1.100" }
 *
 * Fallback: If UDP broadcast is blocked by the Wi-Fi router (common on guest
 * or corporate networks), use manual IP + room code entry in the UI.
 */
public class LanDiscoveryModule extends ReactContextBaseJavaModule {

    private static final String TAG         = "LanDiscovery";
    private static final int    BEACON_PORT = 5354;

    private final ExecutorService executor   = Executors.newCachedThreadPool();
    private final AtomicBoolean   advertising = new AtomicBoolean(false);
    private final AtomicBoolean   scanning    = new AtomicBoolean(false);
    private DatagramSocket        scanSocket;

    public LanDiscoveryModule(ReactApplicationContext ctx) { super(ctx); }

    @Override
    public String getName() { return "LanDiscovery"; }

    @ReactMethod
    public void startAdvertising(String roomCode, String deviceName, int port) {
        if (advertising.getAndSet(true)) return;

        executor.submit(() -> {
            try (DatagramSocket socket = new DatagramSocket()) {
                socket.setBroadcast(true);
                InetAddress broadcast = InetAddress.getByName("255.255.255.255");
                String json = String.format(
                        "{\"roomCode\":\"%s\",\"deviceName\":\"%s\",\"port\":%d}",
                        roomCode, deviceName.replace("\"", ""), port
                );
                byte[] buf = json.getBytes(StandardCharsets.UTF_8);
                DatagramPacket pkt = new DatagramPacket(buf, buf.length, broadcast, BEACON_PORT);

                while (advertising.get()) {
                    // Include source IP by letting the OS fill it
                    socket.send(pkt);
                    Thread.sleep(2000);
                }
            } catch (Exception e) {
                if (advertising.get()) Log.w(TAG, "Advertise error: " + e.getMessage());
            } finally {
                advertising.set(false);
            }
        });
    }

    @ReactMethod
    public void stopAdvertising() { advertising.set(false); }

    @ReactMethod
    public void startScanning(int port, Callback onPeer) {
        if (scanning.getAndSet(true)) return;

        executor.submit(() -> {
            try {
                scanSocket = new DatagramSocket(null);
                scanSocket.setReuseAddress(true);
                scanSocket.setBroadcast(true);
                scanSocket.bind(new InetSocketAddress(BEACON_PORT));
                scanSocket.setSoTimeout(0);

                byte[] buf = new byte[1024];

                while (scanning.get()) {
                    DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                    scanSocket.receive(pkt);
                    String json = new String(pkt.getData(), 0, pkt.getLength(), StandardCharsets.UTF_8);
                    String ip   = pkt.getAddress().getHostAddress();

                    // Append IP to JSON for JS layer
                    String withIp = json.replace("}", ",\"ip\":\"" + ip + "\"}");

                    // Fire callback on JS thread — React Native bridges the call
                    onPeer.invoke(withIp);
                }
            } catch (Exception e) {
                if (scanning.get()) Log.w(TAG, "Scan error: " + e.getMessage());
            } finally {
                scanning.set(false);
                if (scanSocket != null && !scanSocket.isClosed()) scanSocket.close();
            }
        });
    }

    @ReactMethod
    public void stopScanning() {
        scanning.set(false);
        if (scanSocket != null) try { scanSocket.close(); } catch (Exception ignored) {}
    }
}
