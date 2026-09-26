package com.velumix.musecode.phone;

import org.junit.Test;
import static org.junit.Assert.*;

public class DesktopAddressTest {
    @Test public void usbAllowsOnlyTheExactLoopbackEndpoint() {
        DesktopAddress usb = DesktopAddress.parse(DesktopAddress.USB_ORIGIN + "/#pair=" + "d".repeat(64));
        assertTrue(usb.usb);
        assertTrue(usb.contains(DesktopAddress.USB_ORIGIN + "/api/sessions"));
        assertFalse(usb.contains("http://127.0.0.1:8080/api/me"));
        assertFalse(usb.contains("https://desktop.tail123.ts.net:8443/api/me"));
        for (String address : new String[] {"http://192.168.1.1:43827/", "http://localhost:43827/", "http://127.0.0.1:8080/", "http://attacker@127.0.0.1:43827/", "http://127.0.0.1.evil.com:43827/", "http://2130706433:43827/"}) {
            assertThrows(IllegalArgumentException.class, () -> DesktopAddress.parse(address));
        }
    }
    private static final String ORIGIN = "https://desktop.tail123.ts.net:8443";
    @Test public void acceptsDesktopQrButNeverStoresItsSecretInOrigin() {
        String qr = ORIGIN + "/#pair=" + "a".repeat(64);
        DesktopAddress address = DesktopAddress.parse(qr);
        assertEquals(ORIGIN, address.origin);
        assertEquals(qr, address.url);
        assertEquals(ORIGIN + "/", DesktopAddress.parse("  " + ORIGIN + "  ").url);
    }
    @Test public void rejectsUntrustedAddressesAndAmbiguousUrls() {
        String[] invalid = { "http://desktop.tail123.ts.net:8443/", "https://example.com:8443/",
                "https://desktop.tail123.ts.net.evil.com:8443/", "https://desktop.tail123.ts.net@evil.com:8443/",
                "https://evil.com@desktop.tail123.ts.net:8443/", "https://desktop.tail123.ts.net/",
                "https://desktop.tail123.ts.net:443/", "https://100.100.100.100:8443/",
                ORIGIN + "/api/logout", ORIGIN + "/%2e%2e/", ORIGIN + "/?pair=secret",
                ORIGIN + "/#pair=too-short", ORIGIN + "/#pair=" + "a".repeat(64) + "&redirect=evil",
                "javascript:alert(1)", "file:///data/data/credentials", "intent://example.com", "https://x.ts.net:8443/",
                "https://desktop.tail123.ts.net.:8443/", "https://desktop.tail123.ts.net:8443\\@evil.com/", "" };
        for (String input : invalid) assertThrows(input, IllegalArgumentException.class, () -> DesktopAddress.parse(input));
    }
    @Test public void onlyLoadsResourcesFromTheSelectedDesktop() {
        DesktopAddress desktop = DesktopAddress.parse(ORIGIN);
        assertTrue(desktop.contains(ORIGIN + "/api/sessions?after=1"));
        assertTrue(desktop.contains(ORIGIN + "/assets/app.js"));
        assertFalse(desktop.contains("https://other.tail123.ts.net:8443/"));
        assertFalse(desktop.contains(ORIGIN + ".evil.com/"));
        assertFalse(desktop.contains("https://attacker@desktop.tail123.ts.net:8443/"));
        assertFalse(desktop.contains("http://desktop.tail123.ts.net:8443/"));
        assertFalse(desktop.contains(null));
    }
    @Test public void rescanningForcesANewDocumentAndPreservesTheInvitation() {
        DesktopAddress desktop = DesktopAddress.parse(ORIGIN + "/#pair=" + "c".repeat(64));
        String first = desktop.navigationUrl();
        String second = desktop.navigationUrl();
        assertNotEquals(first.split("#")[0], second.split("#")[0]);
        assertTrue(desktop.contains(first));
        assertTrue(first.endsWith("#pair=" + "c".repeat(64)));
        assertEquals(ORIGIN + "/", DesktopAddress.parse(ORIGIN).navigationUrl());
    }
}
