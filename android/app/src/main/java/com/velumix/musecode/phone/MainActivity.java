package com.velumix.musecode.phone;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.PopupMenu;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.zxing.client.android.Intents;
import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;

import java.io.ByteArrayInputStream;

public final class MainActivity extends AppCompatActivity {
    private WebView web;
    private View welcome;
    private View progress;
    private SharedPreferences preferences;
    private volatile DesktopAddress desktop;
    private String connectionUrl;
    private boolean loadFailed;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable connectionTimeout = () -> showOffline(R.string.offline_description);
    private final ActivityResultLauncher<ScanOptions> scanner = registerForActivityResult(new ScanContract(), result -> {
        if (result.getContents() != null) acceptAddress(result.getContents());
        else if (result.getOriginalIntent() != null
                && result.getOriginalIntent().getBooleanExtra(Intents.Scan.MISSING_CAMERA_PERMISSION, false)) {
            Toast.makeText(this, R.string.camera_denied, Toast.LENGTH_LONG).show();
        }
    });

    @Override protected void onCreate(Bundle state) {
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES);
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(false);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightNavigationBars(false);
        setContentView(R.layout.activity_main);
        View root = findViewById(R.id.root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets keyboard = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        preferences = getSharedPreferences("desktop", MODE_PRIVATE);
        web = findViewById(R.id.web);
        welcome = findViewById(R.id.welcome);
        progress = findViewById(R.id.progress);
        configureWebView();
        findViewById(R.id.primary).setOnClickListener(v -> scan());
        findViewById(R.id.paste_link).setOnClickListener(v -> enterAddress());
        findViewById(R.id.tailscale).setOnClickListener(v -> openTailscale());
        findViewById(R.id.usb).setOnClickListener(v -> connectUsb());
        findViewById(R.id.connection_menu).setOnClickListener(this::showMenu);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                // Keep the WebView and drafts alive when returning to the launcher.
                moveTaskToBack(true);
            }
        });
        if (acceptUsbIntent(getIntent())) return;
        String saved = preferences.getString("origin", null);
        if (saved != null) {
            try { connect(DesktopAddress.parse(saved)); }
            catch (IllegalArgumentException e) { preferences.edit().remove("origin").apply(); }
        }
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        acceptUsbIntent(intent);
    }

    private boolean acceptUsbIntent(Intent intent) {
        String value = intent.getStringExtra("muse_usb_url");
        intent.removeExtra("muse_usb_url");
        if (value == null) return false;
        try {
            DesktopAddress address = DesktopAddress.parse(value);
            if (!address.usb) return false;
            acceptAddress(value);
            return true;
        } catch (IllegalArgumentException e) { return false; }
    }

    private void connectUsb() {
        new AlertDialog.Builder(this).setTitle(R.string.usb_title).setMessage(R.string.usb_help)
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.connect, (dialog, which) -> acceptAddress(DesktopAddress.USB_ORIGIN)).show();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = web.getSettings();
        // The existing phone UI needs JavaScript; no native JS bridge is exposed.
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(true);
        settings.setUserAgentString(settings.getUserAgentString() + " MuseCodeAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setBackgroundColor(getColor(R.color.muse_background));
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (desktop != null && desktop.contains(request.getUrl().toString())) return false;
                if (request.isForMainFrame() && request.hasGesture()) openBrowser(request.getUrl());
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                if (("https".equals(scheme) || "http".equals(scheme))
                        && (desktop == null || !desktop.contains(request.getUrl().toString()))) {
                    return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", null, new ByteArrayInputStream(new byte[0]));
                }
                return null;
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap icon) {
                if (desktop != null && desktop.contains(url)) {
                    loadFailed = false;
                    progress.setVisibility(View.VISIBLE);
                    handler.removeCallbacks(connectionTimeout);
                    handler.postDelayed(connectionTimeout, 25000);
                }
            }
            @Override public void onPageFinished(WebView view, String url) {
                handler.removeCallbacks(connectionTimeout);
                progress.setVisibility(View.GONE);
                if (!loadFailed && desktop != null && desktop.contains(url)) {
                    welcome.setVisibility(View.GONE);
                    web.setVisibility(View.VISIBLE);
                    connectionUrl = desktop.origin + "/";
                    web.clearHistory();
                    CookieManager.getInstance().flush();
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline(R.string.offline_description);
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showOffline(R.string.offline_description);
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler callback, SslError error) {
                callback.cancel();
                showOffline(R.string.tls_error);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, android.os.Message result) {
                if (!gesture) return false;
                WebView popup = new WebView(MainActivity.this);
                popup.getSettings().setAllowFileAccess(false);
                popup.getSettings().setAllowContentAccess(false);
                popup.setWebViewClient(new WebViewClient() {
                    private boolean handled;
                    private void open(WebView view, String url) {
                        if (handled || "about:blank".equals(url)) return;
                        handled = true;
                        view.stopLoading();
                        openBrowser(Uri.parse(url));
                        view.destroy();
                    }
                    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                        open(view, request.getUrl().toString());
                        return true;
                    }
                    @Override public void onPageStarted(WebView view, String url, Bitmap icon) {
                        open(view, url);
                    }
                });
                ((WebView.WebViewTransport) result.obj).setWebView(popup);
                result.sendToTarget();
                return true;
            }
        });
    }

    private void scan() {
        scanner.launch(new ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setPrompt(getString(R.string.scan_prompt)).setBeepEnabled(false)
                .setBarcodeImageEnabled(false).setOrientationLocked(false));
    }

    void acceptAddress(String input) {
        final DesktopAddress address;
        try { address = DesktopAddress.parse(input); }
        catch (IllegalArgumentException e) { new AlertDialog.Builder(this).setMessage(R.string.invalid_link).setPositiveButton(android.R.string.ok, null).show(); return; }
        if (desktop != null && !desktop.origin.equals(address.origin)) {
            new AlertDialog.Builder(this).setTitle(R.string.switch_title).setMessage(R.string.switch_message)
                    .setNegativeButton(R.string.cancel, null).setPositiveButton(R.string.connect, (dialog, which) -> connect(address)).show();
        } else connect(address);
    }

    private void connect(DesktopAddress address) {
        Runnable load = () -> {
            desktop = address;
            connectionUrl = address.navigationUrl();
            // Persist only the origin. The one-use QR invitation stays in memory.
            preferences.edit().putString("origin", address.origin).apply();
            findViewById(R.id.connection_bar).setVisibility(View.VISIBLE);
            ((TextView) findViewById(R.id.desktop_name)).setText(address.usb ? getString(R.string.usb_connected) : address.hostname);
            loadConnection();
        };
        if (address.url.contains("#pair=") && address.contains(web.getUrl())) {
            // A fresh scan replaces any expired or declined pending claim.
            web.evaluateJavascript("sessionStorage.removeItem('muse-pair-claim')", ignored -> load.run());
        } else load.run();
    }

    private void loadConnection() {
        if (connectionUrl == null) return;
        loadFailed = false;
        welcome.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        progress.setVisibility(View.VISIBLE);
        handler.removeCallbacks(connectionTimeout);
        handler.postDelayed(connectionTimeout, 25000);
        web.loadUrl(connectionUrl);
    }

    private void showOffline(int message) {
        if (isFinishing() || isDestroyed()) return;
        loadFailed = true;
        handler.removeCallbacks(connectionTimeout);
        web.stopLoading();
        progress.setVisibility(View.GONE);
        web.setVisibility(View.GONE);
        welcome.setVisibility(View.VISIBLE);
        ((TextView) findViewById(R.id.welcome_title)).setText(R.string.offline_title);
        ((TextView) findViewById(R.id.welcome_description)).setText(desktop != null && desktop.usb && message == R.string.offline_description ? R.string.usb_offline : message);
        Button primary = findViewById(R.id.primary);
        primary.setText(R.string.retry);
        primary.setOnClickListener(v -> loadConnection());
        ((Button) findViewById(R.id.paste_link)).setText(R.string.scan_another);
        findViewById(R.id.paste_link).setOnClickListener(v -> scan());
    }

    private void enterAddress() {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint(R.string.link_hint);
        input.setAutofillHints((String[]) null);
        input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        android.widget.FrameLayout container = new android.widget.FrameLayout(this);
        container.setPadding(padding, 0, padding, 0);
        container.addView(input);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle(R.string.link_title).setMessage(R.string.link_help)
                .setView(container).setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.connect, null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try { DesktopAddress.parse(input.getText().toString()); }
            catch (IllegalArgumentException e) { input.setError(getString(R.string.invalid_link)); return; }
            acceptAddress(input.getText().toString()); dialog.dismiss();
        }));
        dialog.show();
    }

    private void showMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add(R.string.reload).setOnMenuItemClickListener(item -> { loadConnection(); return true; });
        menu.getMenu().add(R.string.scan_another).setOnMenuItemClickListener(item -> { scan(); return true; });
        menu.getMenu().add(R.string.paste_link).setOnMenuItemClickListener(item -> { enterAddress(); return true; });
        menu.getMenu().add(R.string.usb_title).setOnMenuItemClickListener(item -> { connectUsb(); return true; });
        menu.getMenu().add(R.string.open_tailscale).setOnMenuItemClickListener(item -> { openTailscale(); return true; });
        menu.getMenu().add(R.string.forget).setOnMenuItemClickListener(item -> {
            new AlertDialog.Builder(this).setTitle(R.string.forget).setMessage(R.string.forget_message)
                    .setNegativeButton(R.string.cancel, null).setPositiveButton(R.string.forget, (dialog, which) -> forgetDesktop()).show();
            return true;
        });
        menu.show();
    }

    private void forgetDesktop() {
        handler.removeCallbacks(connectionTimeout);
        web.stopLoading();
        web.loadUrl("about:blank");
        web.clearHistory();
        web.clearCache(true);
        WebStorage.getInstance().deleteAllData();
        preferences.edit().clear().apply();
        CookieManager.getInstance().removeAllCookies(removed -> {
            CookieManager.getInstance().flush();
            recreate();
        });
    }

    private void openTailscale() {
        Intent launch = getPackageManager().getLaunchIntentForPackage("com.tailscale.ipn");
        if (launch != null) startActivity(launch);
        else openBrowser(Uri.parse("https://play.google.com/store/apps/details?id=com.tailscale.ipn"));
    }

    private void openBrowser(Uri uri) {
        if (!("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) || uri.getHost() == null) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException e) { Toast.makeText(this, R.string.no_browser, Toast.LENGTH_LONG).show(); }
    }

    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onPause() { if (web != null) web.onPause(); super.onPause(); }
    @Override protected void onStop() { CookieManager.getInstance().flush(); super.onStop(); }
    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (web != null) { web.stopLoading(); web.destroy(); }
        super.onDestroy();
    }
}
