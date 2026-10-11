package io.github.jansssss.bookscan;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int SCAN = 41, SAVE = 42;
    private WebView web;
    private File scans, pendingFile;
    private boolean scanning = false, saving = false;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        scans = new File(getFilesDir(), "scans");
        scans.mkdirs();
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/scans/", new WebViewAssetLoader.InternalStoragePathHandler(this, scans))
            .build();
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Bridge(), "BookScanNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                if (response != null) return response;
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", java.util.Collections.emptyMap(), new java.io.ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.getUrl().toString().startsWith(ORIGIN + "/assets/web/");
            }
        });
        // Keep content clear of both the status bar and gesture navigation on Android 15+.
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = android.os.Build.VERSION.SDK_INT >= 30
                ? insets.getInsets(android.view.WindowInsets.Type.systemBars()) : null;
            view.setPadding(bars == null ? insets.getSystemWindowInsetLeft() : bars.left,
                bars == null ? insets.getSystemWindowInsetTop() : bars.top,
                bars == null ? insets.getSystemWindowInsetRight() : bars.right,
                bars == null ? insets.getSystemWindowInsetBottom() : bars.bottom);
            return insets;
        });
        setContentView(web);
        web.loadUrl(ORIGIN + "/assets/web/index.html");
    }

    private void event(String name, JSONObject data) {
        runOnUiThread(() -> {
            if (!isFinishing() && web != null)
                web.evaluateJavascript("window.dispatchEvent(new CustomEvent(" + JSONObject.quote(name) + ",{detail:" + data + "}))", null);
        });
    }
    private void error(String name, String message) {
        JSONObject result = new JSONObject();
        try { result.put("error", message); } catch (Exception ignored) { }
        event(name, result);
    }
    private void scan(int limit) {
        if (scanning) return;
        scanning = true;
        GmsDocumentScannerOptions options = new GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(true).setPageLimit(Math.max(1, Math.min(50, limit)))
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL).build();
        GmsDocumentScanning.getClient(options).getStartScanIntent(this)
            .addOnSuccessListener(sender -> {
                try { startIntentSenderForResult(sender, SCAN, null, 0, 0, 0); }
                catch (Exception e) { scanning = false; error("bookscan-native-scan", e.toString()); }
            }).addOnFailureListener(e -> {
                scanning = false;
                error("bookscan-native-scan", "Google 스캐너를 준비할 수 없습니다. Google Play 서비스와 첫 다운로드 연결을 확인해주세요. " + e.getMessage());
            });
    }
    public class Bridge {
        @JavascriptInterface public void scanDocuments(int limit) { runOnUiThread(() -> scan(limit)); }
        @JavascriptInterface public void saveFile(String encoded, String name, String mime, boolean share) {
            synchronized (MainActivity.this) {
                if (saving) { error("bookscan-native-file", "다른 파일 저장이 진행 중입니다."); return; }
                saving = true;
            }
            io.execute(() -> {
                try {
                    if (encoded.length() > 160 * 1024 * 1024) throw new Exception("파일이 너무 큽니다. 페이지 범위를 줄여주세요.");
                    File dir = new File(getCacheDir(), "shared"); dir.mkdirs();
                    String safeName = name.replaceAll("[^\\p{L}\\p{N}._ -]", "_");
                    if (safeName.isEmpty()) safeName = "BookScan.pdf";
                    final File output = new File(dir, UUID.randomUUID() + "-" + safeName);
                    byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                    try (OutputStream stream = new FileOutputStream(output)) { stream.write(bytes); }
                    final String title = safeName;
                    runOnUiThread(() -> {
                        try {
                            if (share) {
                                Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", output);
                                Intent intent = new Intent(Intent.ACTION_SEND).setType(mime)
                                    .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                startActivity(Intent.createChooser(intent, "파일 공유"));
                                saving = false; event("bookscan-native-file", new JSONObject());
                            } else {
                                pendingFile = output;
                                startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT)
                                    .addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, title), SAVE);
                            }
                        } catch (Exception e) { saving = false; error("bookscan-native-file", e.toString()); }
                    });
                } catch (Exception e) { saving = false; error("bookscan-native-file", e.toString()); }
            });
        }
        @JavascriptInterface public void releaseScan(String filename) {
            if (filename.matches("[a-f0-9-]+\\.jpg")) new File(scans, filename).delete();
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == SCAN) {
            scanning = false;
            if (result != RESULT_OK) { event("bookscan-native-scan", new JSONObject()); return; }
            GmsDocumentScanningResult scanned = GmsDocumentScanningResult.fromActivityResultIntent(data);
            io.execute(() -> {
                try {
                    JSONArray urls = new JSONArray();
                    if (scanned != null && scanned.getPages() != null) {
                        for (GmsDocumentScanningResult.Page page : scanned.getPages()) {
                            String name = UUID.randomUUID() + ".jpg";
                            try (InputStream input = getContentResolver().openInputStream(page.getImageUri());
                                 OutputStream output = new FileOutputStream(new File(scans, name))) {
                                if (input == null) throw new Exception("스캔 결과를 읽을 수 없습니다.");
                                byte[] buffer = new byte[65536]; int n;
                                while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
                            }
                            urls.put(ORIGIN + "/scans/" + name);
                        }
                    }
                    event("bookscan-native-scan", new JSONObject().put("urls", urls));
                } catch (Exception e) { error("bookscan-native-scan", e.toString()); }
            });
        } else if (request == SAVE) {
            final File source = pendingFile; pendingFile = null;
            if (result != RESULT_OK || data == null || data.getData() == null) {
                saving = false; error("bookscan-native-file", "파일 저장을 취소했습니다."); return;
            }
            final Uri destination = data.getData();
            io.execute(() -> {
                try (InputStream input = new java.io.FileInputStream(source);
                     OutputStream output = getContentResolver().openOutputStream(destination)) {
                    if (output == null) throw new Exception("저장 위치를 열 수 없습니다.");
                    byte[] buffer = new byte[65536]; int n;
                    while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
                    source.delete(); event("bookscan-native-file", new JSONObject());
                } catch (Exception e) { error("bookscan-native-file", e.toString()); }
                finally { saving = false; }
            });
        }
    }
    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        if (web != null) { web.removeJavascriptInterface("BookScanNative"); web.destroy(); web = null; }
        io.shutdown(); super.onDestroy();
    }
}
