package com.velumix.musecode.phone;

import android.view.View;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.RenderProcessGoneDetail;
import android.widget.TextView;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.android.controller.ActivityController;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;
import java.util.Map;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class MainActivityTest {
    @Test public void usbLaunchOpensPairingAndDiscardsTheIntentSecret() {
        android.content.Intent intent = new android.content.Intent().putExtra("muse_usb_url", DesktopAddress.USB_ORIGIN + "/#pair=" + "d".repeat(64));
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class, intent).setup()) {
            MainActivity activity = controller.get();
            assertTrue(shadowOf((WebView) activity.findViewById(R.id.web)).getLastLoadedUrl().endsWith("#pair=" + "d".repeat(64)));
            assertFalse(activity.getIntent().hasExtra("muse_usb_url"));
            assertEquals(DesktopAddress.USB_ORIGIN, activity.getSharedPreferences("desktop", 0).getString("origin", null));
            controller.newIntent(new android.content.Intent().putExtra("muse_usb_url", DesktopAddress.USB_ORIGIN + "/#pair=" + "e".repeat(64)));
            assertFalse(activity.getIntent().hasExtra("muse_usb_url"));
        }
    }
    @Test public void launchExtrasCannotOpenAnArbitraryNetworkAddress() {
        android.content.Intent intent = new android.content.Intent().putExtra("muse_usb_url", "http://192.168.1.1:43827/");
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class, intent).setup()) {
            assertNull(shadowOf((WebView) controller.get().findViewById(R.id.web)).getLastLoadedUrl());
            assertNull(controller.get().getSharedPreferences("desktop", 0).getString("origin", null));
        }
    }
    @Test public void startsWithScannerAndProtectsTheWebView() {
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            WebView web = activity.findViewById(R.id.web);
            assertEquals(View.VISIBLE, activity.findViewById(R.id.welcome).getVisibility());
            assertEquals(View.GONE, web.getVisibility());
            assertFalse(web.getSettings().getAllowFileAccess());
            assertFalse(web.getSettings().getAllowContentAccess());
            assertEquals(WebSettings.MIXED_CONTENT_NEVER_ALLOW, web.getSettings().getMixedContentMode());
            assertTrue(web.getSettings().getUserAgentString().contains("VelumCodeAndroid/"));
        }
    }
    @Test public void qrLoadsTheDesktopAndOnlyOriginSurvivesRelaunch() {
        String origin = "https://desktop.tail123.ts.net:8443";
        String qr = origin + "/#pair=" + "b".repeat(64);
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            activity.acceptAddress(qr);
            String loaded = shadowOf((WebView) activity.findViewById(R.id.web)).getLastLoadedUrl();
            assertTrue(loaded.startsWith(origin + "/?connect="));
            assertTrue(loaded.endsWith("#pair=" + "b".repeat(64)));
            assertEquals(origin, activity.getSharedPreferences("desktop", 0).getString("origin", null));
            assertFalse(activity.getSharedPreferences("desktop", 0).getAll().toString().contains("pair="));
        }
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            assertEquals(origin + "/", shadowOf((WebView) controller.get().findViewById(R.id.web)).getLastLoadedUrl());
        }
    }
    @Test public void maliciousQrDoesNotNavigateOrSaveAConnection() {
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            activity.acceptAddress("https://desktop.tail123.ts.net.attacker.com:8443/#pair=" + "c".repeat(64));
            assertNull(activity.getSharedPreferences("desktop", 0).getString("origin", null));
            assertNull(shadowOf((WebView) activity.findViewById(R.id.web)).getLastLoadedUrl());
        }
    }
    @Test public void offOriginNavigationAndResourceRequestsAreBlocked() {
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            activity.acceptAddress("https://desktop.tail123.ts.net:8443/");
            WebView web = activity.findViewById(R.id.web);
            WebResourceRequest foreign = request("https://attacker.com/session");
            assertTrue(web.getWebViewClient().shouldOverrideUrlLoading(web, foreign));
            assertEquals(403, web.getWebViewClient().shouldInterceptRequest(web, foreign).getStatusCode());
            WebResourceRequest local = request("https://desktop.tail123.ts.net:8443/api/me");
            assertFalse(web.getWebViewClient().shouldOverrideUrlLoading(web, local));
            assertNull(web.getWebViewClient().shouldInterceptRequest(web, local));
        }
    }
    private static WebResourceRequest request(String url) {
        return new WebResourceRequest() {
            public Uri getUrl() { return Uri.parse(url); }
            public boolean isForMainFrame() { return true; }
            public boolean isRedirect() { return false; }
            public boolean hasGesture() { return false; }
            public String getMethod() { return "GET"; }
            public Map<String, String> getRequestHeaders() { return Map.of(); }
        };
    }
    @Test public void offlineConnectionRetriesOnResumeAndIgnoresStaleOriginErrors() {
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            activity.acceptAddress(DesktopAddress.USB_ORIGIN);
            WebView web = activity.findViewById(R.id.web);
            web.getWebViewClient().onReceivedError(web, request("https://previous.tail123.ts.net:8443/"), null);
            assertEquals(View.GONE, activity.findViewById(R.id.welcome).getVisibility());
            web.getWebViewClient().onReceivedError(web, request(DesktopAddress.USB_ORIGIN), null);
            assertEquals(View.VISIBLE, activity.findViewById(R.id.welcome).getVisibility());
            assertEquals(activity.getString(R.string.connection_offline), ((TextView)activity.findViewById(R.id.desktop_name)).getText().toString());
            controller.pause().resume();
            assertEquals(DesktopAddress.USB_ORIGIN + "/", shadowOf(web).getLastLoadedUrl());
            assertEquals(activity.getString(R.string.connecting), ((TextView)activity.findViewById(R.id.desktop_name)).getText().toString());
            web.getWebViewClient().onPageFinished(web, DesktopAddress.USB_ORIGIN + "/");
            assertEquals(activity.getString(R.string.usb_connected), ((TextView)activity.findViewById(R.id.desktop_name)).getText().toString());
        }
    }
    @Test public void reclaimedRendererIsRemovedAndHandledWithoutCrashing() {
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            activity.acceptAddress(DesktopAddress.USB_ORIGIN);
            WebView web = activity.findViewById(R.id.web);
            android.webkit.WebViewClient client = web.getWebViewClient();
            boolean handled = client.onRenderProcessGone(web, new RenderProcessGoneDetail() {
                @Override public boolean didCrash() { return false; }
                @Override public int rendererPriorityAtExit() { return 0; }
            });
            assertTrue(handled);
            assertNull(web.getParent());
            client.onPageFinished(web, DesktopAddress.USB_ORIGIN + "/");
            // Closing during the queued recreation must also remain safe.
            activity.finish();
            shadowOf(android.os.Looper.getMainLooper()).idle();
        }
    }
}
