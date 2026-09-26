package studio.codexpocket.mobile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

@CapacitorPlugin(name = "PocketNetwork")
public class PocketNetworkPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void discover(PluginCall call) {
        String nonce = call.getString("nonce", "");
        int port = call.getInt("port", 15731);
        if (!nonce.matches("[a-f0-9]{64}") || port < 1 || port > 65535) {
            call.reject("Invalid discovery request"); return;
        }
        worker.execute(() -> {
            JSArray replies = new JSArray();
            // Interface enumeration includes the phone's hotspot, even when mobile
            // data is the default network. No location or nearby-device permission.
            try (DatagramSocket socket = new DatagramSocket()) {
                socket.setBroadcast(true);
                socket.setSoTimeout(250);
                Set<InetAddress> targets = new LinkedHashSet<>();
                targets.add(InetAddress.getByName("255.255.255.255"));
                Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
                while (interfaces != null && interfaces.hasMoreElements()) {
                    NetworkInterface network = interfaces.nextElement();
                    if (!network.isUp() || network.isLoopback()) continue;
                    for (InterfaceAddress address : network.getInterfaceAddresses()) {
                        if (address.getBroadcast() != null) targets.add(address.getBroadcast());
                    }
                }
                byte[] request = ("{\"service\":\"codex-pocket-discovery-v1\",\"nonce\":\"" + nonce + "\"}").getBytes(StandardCharsets.UTF_8);
                Set<String> seen = new HashSet<>();
                long end = android.os.SystemClock.elapsedRealtime() + 1800;
                long nextSend = 0;
                while (android.os.SystemClock.elapsedRealtime() < end && replies.length() < 24) {
                    if (android.os.SystemClock.elapsedRealtime() >= nextSend) {
                        for (InetAddress target : targets) {
                            try { socket.send(new DatagramPacket(request, request.length, target, port)); } catch (Exception ignored) { }
                        }
                        nextSend = android.os.SystemClock.elapsedRealtime() + 700;
                    }
                    byte[] buffer = new byte[8192];
                    DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                    try {
                        socket.receive(packet);
                        String host = packet.getAddress().getHostAddress();
                        if (!(packet.getAddress() instanceof Inet4Address) || !seen.add(host)) continue;
                        JSObject reply = new JSObject(new String(buffer, 0, packet.getLength(), StandardCharsets.UTF_8));
                        reply.put("url", "http://" + host + ":" + port);
                        replies.put(reply);
                    } catch (SocketTimeoutException ignored) { }
                    catch (Exception ignored) { }
                }
            } catch (Exception ignored) { }
            JSObject result = new JSObject(); result.put("replies", replies); call.resolve(result);
        });
    }

    @Override
    protected void handleOnDestroy() { worker.shutdownNow(); }
}
