package studio.codexpocket.mobile;

import android.graphics.Color;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** System chrome follows the local theme; no credentials or network access. */
@CapacitorPlugin(name = "PocketUI")
public class PocketUIPlugin extends Plugin {
    @PluginMethod
    public void copyText(PluginCall call) {
        String text = call.getString("text", "");
        android.content.ClipboardManager clipboard = (android.content.ClipboardManager) getContext().getSystemService(android.content.Context.CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Codex Pocket", text));
        call.resolve();
    }

    @PluginMethod
    public void configure(PluginCall call) {
        final int background;
        try {
            background = Color.parseColor(call.getString("background", "#f5f3ec"));
        } catch (IllegalArgumentException error) {
            call.reject("Invalid theme color");
            return;
        }
        final boolean light = call.getBoolean("light", true);
        final boolean overlayOpen = call.getBoolean("overlayOpen", false);
        getActivity().runOnUiThread(() -> {
            android.view.Window window = getActivity().getWindow();
            window.setStatusBarColor(background);
            window.setNavigationBarColor(background);
            WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(window, window.getDecorView());
            controller.setAppearanceLightStatusBars(light);
            controller.setAppearanceLightNavigationBars(light);
            getBridge().getWebView().setBackgroundColor(background);
            ((MainActivity) getActivity()).setOverlayOpen(overlayOpen);
            call.resolve();
        });
    }
}
