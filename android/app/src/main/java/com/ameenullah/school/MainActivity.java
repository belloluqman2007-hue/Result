package com.ameenullah.school;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;
import android.webkit.WebBackForwardList;
import android.webkit.WebHistoryItem;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.FileProvider;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Collections;
import java.util.Locale;

public class MainActivity extends BridgeActivity {

    private static final String LOCAL_SPLASH_URL = "https://localhost/index.html";
    private static final String LOCAL_OFFLINE_URL = "https://localhost/offline.html";
    private long lastBackPressTime = 0L;

    private static final String DOCUMENT_START_BRIDGE_JS =
        "(function(){" +
        "if(window.__amsNativeHooked)return;" +
        "window.__amsNativeHooked=true;" +
        "window.AMS_IS_ANDROID_APP=true;" +
        "var blobStore=new Map();" +
        "if(window.URL&&typeof URL.createObjectURL==='function'){" +
        "  var origCreate=URL.createObjectURL.bind(URL);" +
        "  var origRevoke=URL.revokeObjectURL.bind(URL);" +
        "  URL.createObjectURL=function(obj){" +
        "    var u=origCreate(obj);" +
        "    if(obj instanceof Blob){blobStore.set(u,obj);}" +
        "    return u;" +
        "  };" +
        "  URL.revokeObjectURL=function(u){" +
        "    setTimeout(function(){blobStore.delete(u);try{origRevoke(u);}catch(e){}},15000);" +
        "  };" +
        "}" +
        "function sendBlobToAndroid(blob,name){" +
        "  var reader=new FileReader();" +
        "  reader.onloadend=function(){" +
        "    if(reader.result&&window.AmeenullahAndroid){" +
        "      window.AmeenullahAndroid.saveBase64File(String(reader.result),name||'document.pdf',blob.type||'');" +
        "    }" +
        "  };" +
        "  reader.readAsDataURL(blob);" +
        "}" +
        "function interceptAnchorDownload(el){" +
        "  if(!el||el.tagName!=='A'||!window.AmeenullahAndroid)return false;" +
        "  var href=el.href||'';" +
        "  var hasDl=el.hasAttribute('download');" +
        "  var dlName=(el.getAttribute('download')||'').trim();" +
        "  if(href.indexOf('data:')===0&&hasDl){" +
        "    window.AmeenullahAndroid.saveBase64File(href,dlName||'download','');" +
        "    return true;" +
        "  }" +
        "  if(href.indexOf('blob:')===0&&(hasDl||blobStore.has(href))){" +
        "    var known=blobStore.get(href);" +
        "    if(known){sendBlobToAndroid(known,dlName||'document.pdf');return true;}" +
        "    fetch(href).then(function(r){return r.blob();}).then(function(b){" +
        "      sendBlobToAndroid(b,dlName||'document.pdf');" +
        "    }).catch(function(){});" +
        "    return true;" +
        "  }" +
        "  return false;" +
        "}" +
        "var origClick=HTMLAnchorElement.prototype.click;" +
        "HTMLAnchorElement.prototype.click=function(){" +
        "  if(interceptAnchorDownload(this))return;" +
        "  return origClick.apply(this,arguments);" +
        "};" +
        "var origDispatch=HTMLAnchorElement.prototype.dispatchEvent;" +
        "HTMLAnchorElement.prototype.dispatchEvent=function(ev){" +
        "  if(ev&&ev.type==='click'&&interceptAnchorDownload(this))return true;" +
        "  return origDispatch.apply(this,arguments);" +
        "};" +
        "document.addEventListener('click',function(ev){" +
        "  var t=ev.target&&ev.target.closest?ev.target.closest('a[download]'):null;" +
        "  if(t&&interceptAnchorDownload(t)){ev.preventDefault();ev.stopPropagation();}" +
        "},true);" +
        "window.print=function(){" +
        "  if(window.AmeenullahAndroid){" +
        "    window.AmeenullahAndroid.printCurrentPage(document.title||'Ameenullah School');" +
        "  }" +
        "};" +
        "})();";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        styleSystemBars();
        configurePortalWebView();
        setupHardwareBackNavigation();
        handleShortcutIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShortcutIntent(intent);
    }

    @Override
    public void onPause() {
        super.onPause();
        try {
            CookieManager.getInstance().flush();
        } catch (Exception ignored) {
        }
    }

    private void styleSystemBars() {
        Window window = getWindow();
        if (window == null) return;
        window.setStatusBarColor(Color.parseColor("#0B2E22"));
        window.setNavigationBarColor(Color.parseColor("#072017"));
        WindowInsetsControllerCompat insetsController =
            new WindowInsetsControllerCompat(window, window.getDecorView());
        insetsController.setAppearanceLightStatusBars(false);
        insetsController.setAppearanceLightNavigationBars(false);
    }

    @SuppressLint({"SetJavaScriptEnabled", "RequiresFeature"})
    private void configurePortalWebView() {
        final Bridge currentBridge = getBridge();
        if (currentBridge == null || currentBridge.getWebView() == null) {
            return;
        }
        final WebView webView = currentBridge.getWebView();

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        WebSettings settings = webView.getSettings();
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        String ua = settings.getUserAgentString();
        if (ua != null && !ua.contains("AmeenullahAndroidApp")) {
            settings.setUserAgentString(ua + " AmeenullahAndroidApp/1.0");
        }

        webView.addJavascriptInterface(new AmeenullahNativeBridge(webView), "AmeenullahAndroid");

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(
                    webView,
                    DOCUMENT_START_BRIDGE_JS,
                    Collections.singleton("*")
                );
            } catch (Exception ignored) {
            }
        }

        currentBridge.setWebViewClient(new BridgeWebViewClient(currentBridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) {
                    return false;
                }
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase(Locale.US) : "";
                String host = uri.getHost() != null ? uri.getHost().toLowerCase(Locale.US) : "";

                // Native dialer, email, SMS, WhatsApp, and Play Store links open outside WebView
                if (
                    "tel".equals(scheme) ||
                    "mailto".equals(scheme) ||
                    "sms".equals(scheme) ||
                    "whatsapp".equals(scheme) ||
                    "market".equals(scheme) ||
                    "intent".equals(scheme) ||
                    "wa.me".equals(host) ||
                    "api.whatsapp.com".equals(host) ||
                    "chat.whatsapp.com".equals(host) ||
                    "play.google.com".equals(host)
                ) {
                    openExternalUri(uri);
                    return true;
                }

                // Keep all HTTP/HTTPS school portal navigation smoothly inside the app WebView
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    return false;
                }

                return super.shouldOverrideUrlLoading(view, request);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                    view.evaluateJavascript(DOCUMENT_START_BRIDGE_JS, null);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    Uri failingUri = request.getUrl();
                    String host = failingUri != null && failingUri.getHost() != null ? failingUri.getHost() : "";
                    if (!"localhost".equalsIgnoreCase(host)) {
                        view.loadUrl(LOCAL_OFFLINE_URL);
                        return;
                    }
                }
                super.onReceivedError(view, request, error);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                if (request != null && request.isForMainFrame() && errorResponse != null) {
                    int status = errorResponse.getStatusCode();
                    // If the cloud host returns a temporary 502/503/504 sleep gateway error,
                    // return smoothly to the branded wake-up screen which auto-retries.
                    if (status == 502 || status == 503 || status == 504) {
                        Uri failingUri = request.getUrl();
                        String path = failingUri != null && failingUri.getPath() != null ? failingUri.getPath() : "/";
                        view.loadUrl(LOCAL_SPLASH_URL + "?path=" + Uri.encode(path));
                        return;
                    }
                }
                super.onReceivedHttpError(view, request, errorResponse);
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url == null || url.isEmpty()) return;
            String suggested = URLUtil.guessFileName(url, contentDisposition, mimeType);
            if (url.startsWith("data:")) {
                saveDataUrlToDownloads(url, suggested, mimeType);
                return;
            }
            if (url.startsWith("blob:")) {
                String safeJsUrl = url.replace("\\", "\\\\").replace("'", "\\'");
                String safeJsName = suggested.replace("\\", "\\\\").replace("'", "\\'");
                webView.evaluateJavascript(
                    "(function(){fetch('" + safeJsUrl + "').then(function(r){return r.blob();}).then(function(b){" +
                    "var rd=new FileReader();rd.onloadend=function(){" +
                    "if(rd.result&&window.AmeenullahAndroid)window.AmeenullahAndroid.saveBase64File(String(rd.result),'" + safeJsName + "',b.type||'');" +
                    "};rd.readAsDataURL(b);});})();",
                    null
                );
                return;
            }
            enqueueHttpDownload(url, userAgent, contentDisposition, mimeType, suggested);
        });
    }

    private void setupHardwareBackNavigation() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                Bridge currentBridge = getBridge();
                WebView webView = currentBridge != null ? currentBridge.getWebView() : null;
                if (webView != null && canNavigateBackInPortal(webView)) {
                    webView.goBack();
                    return;
                }
                long now = System.currentTimeMillis();
                if (now - lastBackPressTime < 2000L) {
                    finish();
                } else {
                    lastBackPressTime = now;
                    Toast.makeText(MainActivity.this, "Press back again to exit Ameenullah", Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    private boolean canNavigateBackInPortal(WebView webView) {
        if (!webView.canGoBack()) return false;
        String current = webView.getUrl() != null ? webView.getUrl() : "";
        if (current.startsWith(LOCAL_SPLASH_URL) || current.startsWith(LOCAL_OFFLINE_URL)) {
            return false;
        }
        WebBackForwardList history = webView.copyBackForwardList();
        int prevIndex = history.getCurrentIndex() - 1;
        if (prevIndex < 0) return false;
        WebHistoryItem prevItem = history.getItemAtIndex(prevIndex);
        if (prevItem == null || prevItem.getUrl() == null) return false;
        return !prevItem.getUrl().startsWith(LOCAL_SPLASH_URL);
    }

    private void handleShortcutIntent(Intent intent) {
        if (intent == null) return;
        String targetPath = intent.getStringExtra("target_path");
        if (targetPath != null && !targetPath.trim().isEmpty()) {
            intent.removeExtra("target_path");
            Bridge currentBridge = getBridge();
            if (currentBridge != null && currentBridge.getWebView() != null) {
                currentBridge.getWebView().loadUrl(LOCAL_SPLASH_URL + "?path=" + Uri.encode(targetPath.trim()));
            }
        }
    }

    private void openExternalUri(Uri uri) {
        try {
            Intent ext = new Intent(Intent.ACTION_VIEW, uri);
            ext.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(ext);
        } catch (ActivityNotFoundException ex) {
            Toast.makeText(this, "No app installed to open this link.", Toast.LENGTH_SHORT).show();
        }
    }

    private void enqueueHttpDownload(
        String url,
        String userAgent,
        String contentDisposition,
        String mimeType,
        String fileName
    ) {
        try {
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null && !cookies.isEmpty()) {
                req.addRequestHeader("Cookie", cookies);
            }
            if (userAgent != null && !userAgent.isEmpty()) {
                req.addRequestHeader("User-Agent", userAgent);
            }
            if (mimeType != null && !mimeType.isEmpty()) {
                req.setMimeType(mimeType);
            }
            req.setTitle(fileName);
            req.setDescription("Downloading school file...");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm != null) {
                dm.enqueue(req);
                Toast.makeText(this, "Downloading " + fileName + "...", Toast.LENGTH_SHORT).show();
            }
        } catch (Exception ex) {
            openExternalUri(Uri.parse(url));
        }
    }

    private String sanitizeFileName(String rawName, String mimeType) {
        String name = rawName != null ? rawName.trim() : "";
        name = name.replaceAll("[\\\\/:*?\"<>|]+", "_");
        if (name.isEmpty() || "download".equalsIgnoreCase(name) || "download.bin".equalsIgnoreCase(name)) {
            name = "ameenullah-document";
        }
        if (!name.contains(".")) {
            String ext = null;
            if (mimeType != null && !mimeType.isEmpty()) {
                ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
            }
            name = name + "." + (ext != null && !ext.isEmpty() ? ext : "pdf");
        }
        return name;
    }

    private String resolveMimeType(String fileName, String providedMime) {
        if (providedMime != null && !providedMime.isEmpty() && !"application/octet-stream".equalsIgnoreCase(providedMime)) {
            return providedMime;
        }
        String lower = fileName.toLowerCase(Locale.US);
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        return "application/octet-stream";
    }

    private void saveDataUrlToDownloads(String dataUrl, String rawFileName, String rawMime) {
        new Thread(() -> {
            try {
                if (dataUrl == null || !dataUrl.contains(",")) return;
                int commaIdx = dataUrl.indexOf(',');
                String header = dataUrl.substring(0, commaIdx);
                String payload = dataUrl.substring(commaIdx + 1);

                String detectedMime = rawMime;
                if ((detectedMime == null || detectedMime.isEmpty()) && header.startsWith("data:") && header.contains(";")) {
                    detectedMime = header.substring(5, header.indexOf(';'));
                }

                String fileName = sanitizeFileName(rawFileName, detectedMime);
                String mimeType = resolveMimeType(fileName, detectedMime);
                byte[] bytes = Base64.decode(payload, Base64.DEFAULT);

                Uri savedUri = null;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = getContentResolver();
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                    values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    values.put(MediaStore.Downloads.IS_PENDING, 1);

                    Uri itemUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (itemUri != null) {
                        try (OutputStream out = resolver.openOutputStream(itemUri)) {
                            if (out != null) {
                                out.write(bytes);
                                out.flush();
                            }
                        }
                        ContentValues done = new ContentValues();
                        done.put(MediaStore.Downloads.IS_PENDING, 0);
                        resolver.update(itemUri, done, null, null);
                        savedUri = itemUri;
                    }
                } else {
                    File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null || (!dir.exists() && !dir.mkdirs())) {
                        dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    }
                    if (dir != null) {
                        File outFile = new File(dir, fileName);
                        try (FileOutputStream fos = new FileOutputStream(outFile)) {
                            fos.write(bytes);
                            fos.flush();
                        }
                        savedUri = FileProvider.getUriForFile(
                            MainActivity.this,
                            getPackageName() + ".fileprovider",
                            outFile
                        );
                    }
                }

                final Uri openUri = savedUri;
                final String finalName = fileName;
                final String finalMime = mimeType;
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this, "Saved to Downloads: " + finalName, Toast.LENGTH_LONG).show();
                    if (openUri != null) {
                        try {
                            Intent viewIntent = new Intent(Intent.ACTION_VIEW);
                            viewIntent.setDataAndType(openUri, finalMime);
                            viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(viewIntent);
                        } catch (Exception ignored) {
                            // File remains safely saved in Downloads even if no viewer app is installed
                        }
                    }
                });
            } catch (Exception ex) {
                runOnUiThread(() ->
                    Toast.makeText(MainActivity.this, "Could not save file: " + ex.getMessage(), Toast.LENGTH_LONG).show()
                );
            }
        }).start();
    }

    public class AmeenullahNativeBridge {
        private final WebView targetWebView;

        AmeenullahNativeBridge(WebView webView) {
            this.targetWebView = webView;
        }

        @JavascriptInterface
        public void saveBase64File(String dataUrl, String fileName, String mimeType) {
            saveDataUrlToDownloads(dataUrl, fileName, mimeType);
        }

        @JavascriptInterface
        public void printCurrentPage(String jobTitle) {
            runOnUiThread(() -> {
                try {
                    PrintManager printManager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                    if (printManager == null || targetWebView == null) return;
                    String safeJob = (jobTitle != null && !jobTitle.trim().isEmpty())
                        ? jobTitle.trim()
                        : "Ameenullah School Document";
                    PrintDocumentAdapter adapter = targetWebView.createPrintDocumentAdapter(safeJob);
                    PrintAttributes attrs = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .build();
                    printManager.print(safeJob, adapter, attrs);
                } catch (Exception ex) {
                    Toast.makeText(MainActivity.this, "Print unavailable on this device.", Toast.LENGTH_SHORT).show();
                }
            });
        }
    }
}
