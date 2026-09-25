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

    public void setOverlayOpen(boolean open) {
        if (overlayBack != null) overlayBack.setEnabled(open);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PocketCredentialsPlugin.class);
        registerPlugin(PocketUIPlugin.class);
        super.onCreate(savedInstanceState);
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
}
