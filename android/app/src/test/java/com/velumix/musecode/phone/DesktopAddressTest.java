package com.velumix.musecode.phone;

import org.junit.Test;
import static org.junit.Assert.*;

public class DesktopAddressTest {
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
}
