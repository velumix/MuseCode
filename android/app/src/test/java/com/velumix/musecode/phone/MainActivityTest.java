package com.velumix.musecode.phone;

import android.view.View;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
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
    @Test public void startsWithScannerAndProtectsTheWebView() {
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            WebView web = activity.findViewById(R.id.web);
            assertEquals(View.VISIBLE, activity.findViewById(R.id.welcome).getVisibility());
            assertEquals(View.GONE, web.getVisibility());
            assertFalse(web.getSettings().getAllowFileAccess());
            assertFalse(web.getSettings().getAllowContentAccess());
            assertEquals(WebSettings.MIXED_CONTENT_NEVER_ALLOW, web.getSettings().getMixedContentMode());
            assertTrue(web.getSettings().getUserAgentString().contains("MuseCodeAndroid/"));
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
}
