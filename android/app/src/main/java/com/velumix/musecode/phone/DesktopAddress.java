package com.velumix.musecode.phone;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/** Only private Tailscale HTTPS or MuseCode's exact USB loopback endpoint. */
final class DesktopAddress {
    static final String USB_ORIGIN = "http://127.0.0.1:43827";
    private static final Pattern HOST = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.ts\\.net");
    final String origin;
    final String url;
    final String hostname;
    final boolean usb;

    private DesktopAddress(URI uri) {
        hostname = uri.getHost().toLowerCase(Locale.ROOT);
        usb = "http".equalsIgnoreCase(uri.getScheme());
        origin = usb ? USB_ORIGIN : "https://" + hostname + ":8443";
        url = origin + "/" + (uri.getRawFragment() == null ? "" : "#" + uri.getRawFragment());
    }

    static DesktopAddress parse(String input) {
        if (input == null || input.length() > 1024) throw new IllegalArgumentException("Invalid desktop link");
        try {
            URI uri = new URI(input.trim());
            String host = uri.getHost();
            boolean tailnet = "https".equalsIgnoreCase(uri.getScheme()) && host != null
                    && HOST.matcher(host.toLowerCase(Locale.ROOT)).matches() && uri.getPort() == 8443;
            boolean cable = "http".equalsIgnoreCase(uri.getScheme()) && "127.0.0.1".equals(host) && uri.getPort() == 43827;
            if ((!tailnet && !cable) || uri.getRawUserInfo() != null || uri.getRawQuery() != null
                    || !(uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath()))
                    || (uri.getRawFragment() != null && !uri.getRawFragment().matches("pair=[a-f0-9]{64}"))) {
                throw new IllegalArgumentException("Invalid desktop link");
            }
            return new DesktopAddress(uri);
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("Invalid desktop link");
        }
    }

    boolean contains(String value) {
        try {
            URI uri = new URI(value);
            return (usb ? "http" : "https").equalsIgnoreCase(uri.getScheme()) && hostname.equalsIgnoreCase(uri.getHost())
                    && uri.getPort() == (usb ? 43827 : 8443) && uri.getRawUserInfo() == null;
        } catch (URISyntaxException | NullPointerException e) { return false; }
    }

    String navigationUrl() {
        int fragment = url.indexOf('#');
        // A new fragment alone is a same-document navigation. The phone UI reads
        // invitations on mount, so each scan must create a fresh document.
        return fragment < 0 ? url : origin + "/?connect=" + UUID.randomUUID() + url.substring(fragment);
    }
}
