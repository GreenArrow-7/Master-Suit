package com.youhan.one;

import android.os.Bundle;
import android.text.Html;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Three things a WebView shell of the web app needs that Capacitor core does not do.
 *
 * Back: core registers nothing for the system Back gesture, so Back closed the app
 * from any screen. It now walks the page history and leaves the app only from the
 * first page, which is what the same pages do in a browser tab.
 *
 * Load failure: the app has no bundled copy of the site, and Capacitor's `errorPath`
 * resolves against the server origin, which is unreachable in exactly the case it is
 * for. A failed main-frame load now shows a local page with a retry to the server
 * URL, instead of the WebView's raw error page. Sub-resource failures are left alone.
 *
 * Session: the WebView writes cookies to disk on its own schedule. Flushing when
 * the app goes to the background means a process the system later kills does not
 * sign the user out.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) return; // no WebView on this device: Capacitor showed its own screen

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = bridge.getWebView();
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });

        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) showOffline(view);
            }
        });
    }

    @Override
    public void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    private void showOffline(WebView webView) {
        // getAppUrl is the server URL when one is configured, else the bundled local URL.
        String target = Html.escapeHtml(bridge.getAppUrl());
        String page =
            "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>" +
            "<title>Offline</title><style>body{font-family:sans-serif;margin:0;display:flex;min-height:100vh;" +
            "align-items:center;justify-content:center;background:#0B1B3A;color:#fff;text-align:center;padding:24px}" +
            "a{display:inline-block;margin-top:20px;padding:12px 28px;border-radius:8px;background:#fff;" +
            "color:#0B1B3A;text-decoration:none;font-weight:600}</style></head><body><div>" +
            "<h1 style='font-size:20px'>YOUHAN ONE can't connect</h1>" +
            "<p>Check your internet connection, then try again.</p>" +
            "<a href='" + target + "'>Try again</a></div></body></html>";
        // No base URL: the page gets an opaque origin, so it is never the server's origin.
        webView.loadDataWithBaseURL(null, page, "text/html", "UTF-8", null);
    }
}
