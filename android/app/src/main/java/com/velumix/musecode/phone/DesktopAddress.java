package com.velumix.musecode.phone;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/** Only MuseCode's private HTTPS origin can become an in-app desktop. */
final class DesktopAddress {
    private static final Pattern HOST = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.ts\\.net");
    final String origin;
    final String url;
    final String hostname;

    private DesktopAddress(URI uri) {
        hostname = uri.getHost().toLowerCase(Locale.ROOT);
        origin = "https://" + hostname + ":8443";
        url = origin + "/" + (uri.getRawFragment() == null ? "" : "#" + uri.getRawFragment());
    }

    static DesktopAddress parse(String input) {
        if (input == null || input.length() > 1024) throw new IllegalArgumentException("Invalid desktop link");
        try {
            URI uri = new URI(input.trim());
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null
                    || !HOST.matcher(host.toLowerCase(Locale.ROOT)).matches() || uri.getPort() != 8443
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null
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
            return "https".equalsIgnoreCase(uri.getScheme()) && hostname.equalsIgnoreCase(uri.getHost())
                    && uri.getPort() == 8443 && uri.getRawUserInfo() == null;
        } catch (URISyntaxException | NullPointerException e) { return false; }
    }

    String navigationUrl() {
        int fragment = url.indexOf('#');
        // A new fragment alone is a same-document navigation. The phone UI reads
        // invitations on mount, so each scan must create a fresh document.
        return fragment < 0 ? url : origin + "/?connect=" + UUID.randomUUID() + url.substring(fragment);
    }
}
