package studio.codexpocket.mobile;

import android.graphics.Color;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private OnBackPressedCallback overlayBack;
    private android.net.ConnectivityManager networkManager;
    private android.net.ConnectivityManager.NetworkCallback networkCallback;

    private void dispatchLifecycle(String name) {
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().evaluateJavascript("window.dispatchEvent(new Event('" + name + "'))", null);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        dispatchLifecycle("pocketResume");
    }

    @Override
    public void onPause() {
        dispatchLifecycle("pocketPause");
        super.onPause();
    }

    public void setOverlayOpen(boolean open) {
        if (overlayBack != null) overlayBack.setEnabled(open);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PocketCredentialsPlugin.class);
        registerPlugin(PocketUIPlugin.class);
        registerPlugin(PocketNetworkPlugin.class);
        super.onCreate(savedInstanceState);
        networkManager = (android.net.ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        networkCallback = new android.net.ConnectivityManager.NetworkCallback() {
            private void changed() { runOnUiThread(() -> dispatchLifecycle("pocketNetwork")); }
            @Override public void onAvailable(android.net.Network network) { changed(); }
            @Override public void onLost(android.net.Network network) { changed(); }
            @Override public void onLinkPropertiesChanged(android.net.Network network, android.net.LinkProperties properties) { changed(); }
        };
        try { networkManager.registerDefaultNetworkCallback(networkCallback); }
        catch (Exception ignored) { networkCallback = null; }
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        getWindow().setStatusBarColor(Color.rgb(245, 243, 236));
        getWindow().setNavigationBarColor(Color.rgb(245, 243, 236));
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(
            getWindow(), getWindow().getDecorView()
        );
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);
        overlayBack = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(bridge.getWebView());
                if (insets != null && insets.isVisible(WindowInsetsCompat.Type.ime())) {
                    controller.hide(WindowInsetsCompat.Type.ime());
                } else {
                    bridge.getWebView().evaluateJavascript("window.dispatchEvent(new Event('pocketBack'))", null);
                }
            }
        };
        getOnBackPressedDispatcher().addCallback(this, overlayBack);
        // Report the already resized WebView: do not subtract the keyboard twice.
        bridge.getWebView().addOnLayoutChangeListener((view, l, t, r, b, ol, ot, or, ob) -> {
            if (b - t == ob - ot && r - l == or - ol) return;
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(view);
            boolean keyboard = insets != null && insets.isVisible(WindowInsetsCompat.Type.ime());
            bridge.getWebView().evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('pocketViewport',{detail:{height:" +
                (b - t) + "/window.devicePixelRatio,keyboardVisible:" + keyboard + "}}))", null);
        });
    }

    @Override
    public void onDestroy() {
        if (networkCallback != null) {
            try { networkManager.unregisterNetworkCallback(networkCallback); } catch (Exception ignored) { }
        }
        super.onDestroy();
    }
}
