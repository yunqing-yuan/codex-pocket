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
    public void previewHtml(PluginCall call) {
        getBridge().execute(() -> {
            try {
                String html = call.getString("html", "");
                byte[] bytes = html.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                if (bytes.length > 40 * 1024 * 1024) throw new IllegalArgumentException();
                java.io.File directory = new java.io.File(getContext().getCacheDir(), "previews");
                if (!directory.exists() && !directory.mkdirs()) throw new java.io.IOException();
                String key = java.util.UUID.randomUUID().toString() + ".html";
                java.io.File file = new java.io.File(directory, key);
                try (java.io.FileOutputStream stream = new java.io.FileOutputStream(file)) { stream.write(bytes); }
                android.content.Intent intent = new android.content.Intent(getActivity(), PocketPreviewActivity.class);
                intent.putExtra("key", key); intent.putExtra("title", call.getString("name", "HTML 预览"));
                getActivity().runOnUiThread(() -> {
                    try { getActivity().startActivity(intent); call.resolve(); }
                    catch (Exception error) { file.delete(); call.reject("无法打开预览"); }
                });
            } catch (Exception error) { call.reject("HTML 预览过大或无法打开"); }
        });
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        getBridge().execute(() -> {
            try {
                String name = call.getString("name", "作品").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
                if (name.isEmpty() || name.equals(".") || name.equals("..")) name = "作品";
                if (name.length() > 160) name = name.substring(name.length() - 160);
                String data = call.getString("base64", "");
                if (data.length() > 28 * 1024 * 1024) throw new IllegalArgumentException("File too large");
                byte[] bytes = android.util.Base64.decode(data, android.util.Base64.DEFAULT);
                if (bytes.length > 20 * 1024 * 1024) throw new IllegalArgumentException("File too large");
                java.io.File directory = new java.io.File(getContext().getCacheDir(), "artifacts");
                if (!directory.exists() && !directory.mkdirs()) throw new java.io.IOException("Cannot create cache");
                java.io.File[] oldFiles = directory.listFiles();
                if (oldFiles != null) for (java.io.File old : oldFiles) {
                    if (System.currentTimeMillis() - old.lastModified() > 24L * 60 * 60 * 1000) old.delete();
                }
                java.io.File file = new java.io.File(directory, name);
                try (java.io.FileOutputStream stream = new java.io.FileOutputStream(file)) { stream.write(bytes); }
                android.net.Uri uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_SEND);
                intent.setType(call.getString("mime", "application/octet-stream"));
                intent.putExtra(android.content.Intent.EXTRA_STREAM, uri);
                intent.setClipData(android.content.ClipData.newRawUri("file", uri));
                intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().runOnUiThread(() -> {
                    try { getActivity().startActivity(android.content.Intent.createChooser(intent, "分享或保存作品")); call.resolve(); }
                    catch (Exception error) { call.reject("未找到可接收此文件的应用"); }
                });
            } catch (Exception error) { call.reject("无法准备分享文件，请重新打开作品后重试"); }
        });
    }

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
