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
    private static android.webkit.WebChromeClient.FileChooserParams pictureParams() {
        return new android.webkit.WebChromeClient.FileChooserParams() {
            public int getMode() { return MODE_OPEN; }
            public String[] getAcceptTypes() { return new String[]{"image/png", "image/jpeg", "image/webp"}; }
            public boolean isCaptureEnabled() { return false; }
            public CharSequence getTitle() { return "Bot picture"; }
            public String getFilenameHint() { return null; }
            public android.content.Intent createIntent() { return new android.content.Intent(android.content.Intent.ACTION_GET_CONTENT).setType("image/*"); }
        };
    }
    @Test public void avatarPickerLaunchesAndCancellationCompletesItsCallbackOnce() {
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity=controller.get();activity.acceptAddress(DesktopAddress.USB_ORIGIN);
            WebView web=activity.findViewById(R.id.web);
            java.util.List<Uri[]> results=new java.util.ArrayList<>();
            assertTrue(web.getWebChromeClient().onShowFileChooser(web,results::add,pictureParams()));
            android.content.Intent launched=shadowOf(activity).getNextStartedActivityForResult().intent;
            assertEquals("image/*",launched.getType());
            activity.finishPicture(null);activity.finishPicture(null);
            assertEquals(1,results.size());assertNull(results.get(0));
            assertFalse(web.getSettings().getAllowContentAccess());assertFalse(web.getSettings().getAllowFileAccess());
        }
    }
    @Test public void avatarPickerRejectsNonContentUrisAndResultsAfterNavigation() {
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity=controller.get();activity.acceptAddress(DesktopAddress.USB_ORIGIN);
            WebView web=activity.findViewById(R.id.web);java.util.List<Uri[]> results=new java.util.ArrayList<>();
            for(String uri:new String[]{"file:///data/private.png","https://outside.test/image.png"}){
                web.getWebChromeClient().onShowFileChooser(web,results::add,pictureParams());activity.finishPicture(Uri.parse(uri));
            }
            assertEquals(2,results.size());assertNull(results.get(0));assertNull(results.get(1));
            web.getWebChromeClient().onShowFileChooser(web,results::add,pictureParams());
            web.getWebViewClient().onPageStarted(web,DesktopAddress.USB_ORIGIN+"/",null);
            // A replacement request cannot consume the old picker's pending result.
            web.getWebChromeClient().onShowFileChooser(web,results::add,pictureParams());
            activity.finishPicture(Uri.parse("content://media/images/1"));
            assertEquals(4,results.size());assertNull(results.get(2));assertNull(results.get(3));
        }
    }
    @Test public void avatarPickerReturnsOnlyAnImageToTheOriginalDesktop() {
        android.content.ContentProvider provider=new android.content.ContentProvider(){
            public boolean onCreate(){return true;}
            public String getType(Uri uri){return uri.getPath().endsWith("png")?"image/png":"text/plain";}
            public android.database.Cursor query(Uri u,String[] p,String s,String[] a,String order){return null;}
            public Uri insert(Uri u,android.content.ContentValues v){return null;}
            public int delete(Uri u,String s,String[] a){return 0;}
            public int update(Uri u,android.content.ContentValues v,String s,String[] a){return 0;}
        };
        org.robolectric.shadows.ShadowContentResolver.registerProviderInternal("fixture.images",provider);
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity=controller.get();activity.acceptAddress(DesktopAddress.USB_ORIGIN);
            WebView web=activity.findViewById(R.id.web);java.util.List<Uri[]> results=new java.util.ArrayList<>();
            web.getWebChromeClient().onShowFileChooser(web,results::add,pictureParams());activity.finishPicture(Uri.parse("content://fixture.images/photo.png"));
            assertArrayEquals(new Uri[]{Uri.parse("content://fixture.images/photo.png")},results.get(0));
            web.getWebChromeClient().onShowFileChooser(web,results::add,pictureParams());activity.finishPicture(Uri.parse("content://fixture.images/not-image.txt"));assertNull(results.get(1));
        }
    }
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
