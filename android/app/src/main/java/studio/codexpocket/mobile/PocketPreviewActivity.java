package studio.codexpocket.mobile;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.view.Gravity;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** A separate WebView with no Capacitor/native JS interfaces or bridge credentials. */
public class PocketPreviewActivity extends Activity {
    private WebView preview;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.WHITE);
        LinearLayout toolbar = new LinearLayout(this); toolbar.setGravity(Gravity.CENTER_VERTICAL);
        Button back = new Button(this); back.setText("返回"); back.setOnClickListener(view -> finish()); toolbar.addView(back);
        TextView title = new TextView(this); title.setText(getIntent().getStringExtra("title")); title.setTextColor(Color.rgb(39, 62, 56)); title.setSingleLine(true); toolbar.addView(title, new LinearLayout.LayoutParams(0, -2, 1)); root.addView(toolbar);
        preview = new WebView(this);
        preview.getSettings().setJavaScriptEnabled(true);
        preview.getSettings().setAllowFileAccess(false);
        preview.getSettings().setAllowContentAccess(false);
        preview.getSettings().setBlockNetworkLoads(true);
        preview.getSettings().setSupportMultipleWindows(false);
        preview.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                if ("data".equals(scheme) || "blob".equals(scheme)) return null;
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
        });
        root.addView(preview, new LinearLayout.LayoutParams(-1, 0, 1)); setContentView(root);
        String key = getIntent().getStringExtra("key");
        if (key == null || !key.matches("[a-f0-9-]{36}\\.html")) { finish(); return; }
        File file = new File(new File(getCacheDir(), "previews"), key);
        try {
            if (file.length() > 40L * 1024 * 1024) throw new IllegalArgumentException();
            String html = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8); file.delete();
            preview.loadDataWithBaseURL("https://preview.invalid/", html, "text/html", "UTF-8", null);
        } catch (Exception error) { title.setText("预览暂不可用，请返回重试"); }
    }
    @Override protected void onDestroy() {
        if (preview != null) { preview.stopLoading(); preview.loadUrl("about:blank"); preview.destroy(); }
        super.onDestroy();
    }
}
