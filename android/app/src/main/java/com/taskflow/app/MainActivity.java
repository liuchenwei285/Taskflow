package com.taskflow.app;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.view.PixelCopy;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.animation.PathInterpolator;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

/**
 * Taskflow 的 WebView 宿主（单 Activity）。
 *
 * 主题与取色：
 *  - 颜色唯一来源是 res/values/colors.xml 与 res/values-night/colors.xml；
 *  - API 31+ 用系统 Monet 色板生成 primary/container（等价于 DynamicColors），
 *    但 background / surface / outline 固定为资源色（等价于 NeutralSurfaces ThemeOverlay），
 *    壁纸变化只影响强调色，不改变底色；
 *  - 开关状态存 SharedPreferences，可在「我的」页切换。
 *
 * 主题切换动画：
 *  - 先把当前窗口截成一张位图（API 26+ PixelCopy，24–25 decorView.draw）；
 *  - 遮罩层 RevealOverlayView 盖在窗口最上层，在遮罩之下把网页主题一次性切好；
 *  - 下一帧起 ValueAnimator 让半径 0→R，PathInterpolator(0.32, 0.72, 0, 1)，500ms；
 *  - 动画期间网页停止逐秒重绘，结束（或取消）后统一补刷，避免抢帧。
 *  - 系统动画关闭 / 省电模式 / 截图失败时，直接切换不做动画。
 */
public class MainActivity extends Activity {

    private static final String TAG = "Taskflow";
    private static final String APP_URL = "file:///android_asset/index.html";
    private static final int REQ_NOTIFY = 1001;
    private static final String PREF = "taskflow_prefs";
    private static final String K_THEME = "theme_dark";
    private static final String K_DYNAMIC = "dynamic_color";
    private static final long REVEAL_MS = 500L;

    /** CSS 变量名 -> 颜色资源名 */
    private static final String[][] TOKENS = {
            {"--bg", "tf_bg"},
            {"--surface", "tf_surface"},
            {"--surface-variant", "tf_surface_variant"},
            {"--on-bg", "tf_on_bg"},
            {"--on-sv", "tf_on_surface_variant"},
            {"--outline", "tf_outline"},
            {"--outline-strong", "tf_outline_strong"},
            {"--accent", "tf_accent"},
            {"--on-accent", "tf_on_accent"},
            {"--accent-strong", "tf_accent_strong"},
            {"--accent-soft", "tf_accent_soft"},
            {"--primary-container", "tf_primary_container"},
            {"--on-primary-container", "tf_on_primary_container"},
            {"--danger", "tf_error"},
            {"--danger-soft", "tf_error_container"},
            {"--error-container", "tf_error_container"},
            {"--on-error-container", "tf_on_error_container"},
            {"--scrim", "tf_scrim"}
    };

    private WebView webView;
    private FrameLayout root;
    private boolean webDark;
    private boolean dynamicEnabled;

    private RevealOverlayView overlay;
    private Bitmap snapshot;
    private ValueAnimator revealAnimator;
    private boolean isSwitching;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        SharedPreferences sp = getSharedPreferences(PREF, MODE_PRIVATE);
        int nightMask = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        boolean systemDark = nightMask == Configuration.UI_MODE_NIGHT_YES;
        webDark = sp.contains(K_THEME) ? sp.getBoolean(K_THEME, systemDark) : systemDark;
        dynamicEnabled = sp.getBoolean(K_DYNAMIC, true) && supportsDynamicColor();

        // 冷启动：先定窗口底色再挂内容，避免白/黑闪
        applyWindowBackground(webDark);

        root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.setBackgroundColor(surfaceColor(webDark));

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(webView);
        setContentView(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);

        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return false;
                return handleUrl(req.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pushThemeTokens();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                request.deny();
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.message() + " @" + m.lineNumber());
                return true;
            }
        });

        root.post(new Runnable() {
            @Override public void run() { ensureNotificationPermission(); }
        });

        applySystemBars();

        if (savedInstanceState == null) {
            webView.loadUrl(APP_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private boolean handleUrl(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme();
        if ("file".equals(scheme) || "about".equals(scheme) || "data".equals(scheme)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException e) {
            toast("无法打开该链接");
        }
        return true;
    }

    private void ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(
                new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
    }

    /* ============================================================
     * 颜色：资源 + 动态取色
     * ============================================================ */

    private boolean isSystemNight() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
    }

    private boolean supportsDynamicColor() {
        return Build.VERSION.SDK_INT >= 31;
    }

    private int resolveColor(String resName, boolean night) {
        int id = getResources().getIdentifier(resName, "color", getPackageName());
        if (id == 0) return Color.TRANSPARENT;
        Context ctx = this;
        if (night != isSystemNight()) {
            Configuration c = new Configuration(getResources().getConfiguration());
            c.uiMode = (c.uiMode & ~Configuration.UI_MODE_NIGHT_MASK)
                    | (night ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO);
            ctx = createConfigurationContext(c);
        }
        return ctx.getResources().getColor(id, null);
    }

    /** 系统 Monet 强调色；不可用时返回 0。 */
    private int monet(String resName) {
        if (!supportsDynamicColor()) return 0;
        try {
            int id = getResources().getIdentifier(resName, "color", "android");
            if (id == 0) return 0;
            return getResources().getColor(id, null);
        } catch (Exception e) {
            return 0;
        }
    }

    private static String cssColor(int c) {
        int a = (c >>> 24) & 0xFF, r = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, b = c & 0xFF;
        if (a == 0xFF) return String.format(java.util.Locale.US, "#%02X%02X%02X", r, g, b);
        return String.format(java.util.Locale.US, "rgba(%d,%d,%d,%.3f)", r, g, b, a / 255f);
    }

    private int surfaceColor(boolean night) {
        return resolveColor("tf_bg", night);
    }

    /** 一套调色板：资源色打底，动态取色只覆盖 primary 系列。 */
    private String paletteJson(boolean night) {
        StringBuilder sb = new StringBuilder(900);
        sb.append('{');
        int i = 0;
        for (String[] t : TOKENS) {
            if (i++ > 0) sb.append(',');
            sb.append('"').append(t[0]).append("\":\"")
              .append(cssColor(resolveColor(t[1], night))).append('"');
        }

        int primary, onPrimary, primaryContainer, onPrimaryContainer;
        if (dynamicEnabled && supportsDynamicColor()) {
            int p = monet(night ? "system_accent1_200" : "system_accent1_600");
            int op = monet(night ? "system_accent1_800" : "system_accent1_0");
            int pc = monet(night ? "system_accent1_700" : "system_accent1_100");
            int opc = monet(night ? "system_accent1_100" : "system_accent1_900");
            primary = p != 0 ? p : resolveColor("tf_accent", night);
            onPrimary = op != 0 ? op : resolveColor("tf_on_accent", night);
            primaryContainer = pc != 0 ? pc : resolveColor("tf_primary_container", night);
            onPrimaryContainer = opc != 0 ? opc : resolveColor("tf_on_primary_container", night);
        } else {
            primary = resolveColor("tf_accent", night);
            onPrimary = resolveColor("tf_on_accent", night);
            primaryContainer = resolveColor("tf_primary_container", night);
            onPrimaryContainer = resolveColor("tf_on_primary_container", night);
        }

        // 计时块底色 = accent 12% 叠在 surface 上（与静态主题一致）
        int accent = resolveColor("tf_accent", night);
        int timerBg = (accent & 0x00FFFFFF) | (0x1F << 24);
        int track = night
                ? ((resolveColor("tf_on_bg", night) & 0x00FFFFFF) | (0x1F << 24))
                : resolveColor("tf_surface_variant", night);
        sb.append(",\"--timer-bg\":\"").append(cssColor(timerBg)).append('"')
          .append(",\"--progress-track\":\"").append(cssColor(track)).append('"');

        sb.append(",\"--primary\":\"").append(cssColor(primary)).append('"')
          .append(",\"--on-primary\":\"").append(cssColor(onPrimary)).append('"')
          .append(",\"--primary-container\":\"").append(cssColor(primaryContainer)).append('"')
          .append(",\"--on-primary-container\":\"").append(cssColor(onPrimaryContainer)).append('"')
          .append(",\"--progress\":\"")
          .append(cssColor(dynamicEnabled && supportsDynamicColor()
                  ? primary : resolveColor("tf_accent_strong", night)))
          .append('"');
        sb.append('}');
        return sb.toString();
    }

    private String buildThemeTokens() {
        return "{\"light\":" + paletteJson(false)
                + ",\"dark\":" + paletteJson(true)
                + ",\"darkActive\":" + webDark
                + ",\"dynamic\":" + dynamicEnabled
                + ",\"dynamicSupported\":" + supportsDynamicColor() + "}";
    }

    private void pushThemeTokens() {
        if (webView == null) return;
        final String json = buildThemeTokens();
        webView.post(new Runnable() {
            @Override public void run() {
                if (webView != null) {
                    webView.evaluateJavascript(
                            "window.__onThemeTokens && window.__onThemeTokens(" + json + ");", null);
                }
            }
        });
    }

    /** 冷启动时直接给窗口定底色（在 setContentView 之前调用）。 */
    private void applyWindowBackground(boolean dark) {
        Window w = getWindow();
        int bg = surfaceColor(dark);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            w.setStatusBarColor(bg);
            w.setNavigationBarColor(bg);
        }
        w.getDecorView().setBackgroundColor(bg);
    }

    /** 状态栏 / 导航栏：底色与图标明暗跟随当前主题。 */
    private void applySystemBars() {
        int bg = surfaceColor(webDark);
        if (root != null) root.setBackgroundColor(bg);
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            w.setStatusBarColor(bg);
            w.setNavigationBarColor(bg);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            android.view.WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                int mask = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(webDark ? 0 : mask, mask);
            }
        } else {
            View decor = w.getDecorView();
            int flags = decor.getSystemUiVisibility();
            if (Build.VERSION.SDK_INT >= 23) {
                if (!webDark) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                else flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            }
            if (Build.VERSION.SDK_INT >= 27) {
                if (!webDark) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                else flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            decor.setSystemUiVisibility(flags);
        }
    }

    /* ============================================================
     * 主题切换：快照遮罩 + 反向挖洞
     * ============================================================ */

    private boolean animatorsDisabled() {
        try {
            float scale = Settings.Global.getFloat(getContentResolver(),
                    Settings.Global.ANIMATOR_DURATION_SCALE, 1f);
            if (scale == 0f) return true;
        } catch (Exception ignored) {
        }
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && pm.isPowerSaveMode()) return true;
        } catch (Exception ignored) {
        }
        return false;
    }

    /**
     * 网页层点击主题按钮后调用。
     * cxFrac/cyFrac 为按钮中心在窗口内的归一化坐标（0..1）。
     */
    private void startThemeReveal(final float cxFrac, final float cyFrac, final boolean dark) {
        startThemeReveal(cxFrac, cyFrac, dark, false);
    }

    /**
     * @param force true 表示主题不变、只换调色板（动态取色开关），仍要走一次转场
     */
    private void startThemeReveal(final float cxFrac, final float cyFrac, final boolean dark, final boolean force) {
        if (isSwitching || webView == null) return;
        if (!force && dark == webDark) return;

        webDark = dark;
        persistTheme(dark);

        if (animatorsDisabled()) {
            applyThemeInstant(dark);
            return;
        }

        isSwitching = true;
        pauseWebUi(true);

        captureWindow(new Runnable() {
            @Override public void run() {
                if (snapshot == null) {
                    // 截图失败：直接切，不留残影
                    applyThemeInstant(dark);
                    isSwitching = false;
                    pauseWebUi(false);
                    return;
                }
                showOverlayAndAnimate(cxFrac, cyFrac, dark);
            }
        });
    }

    private void applyThemeInstant(boolean dark) {
        webDark = dark;
        applySystemBars();
        if (webView != null) {
            webView.evaluateJavascript(
                    "window.__applyThemeInstant && window.__applyThemeInstant(" + dark + ");", null);
        }
    }

    private void pauseWebUi(boolean paused) {
        if (webView == null) return;
        webView.evaluateJavascript(
                "window.__setUiPaused && window.__setUiPaused(" + paused + ");", null);
    }

    /** 截当前窗口：API 26+ PixelCopy，24–25 用 decorView.draw。 */
    private void captureWindow(final Runnable onReady) {
        final View decor = getWindow().getDecorView();
        final int w = decor.getWidth(), h = decor.getHeight();
        if (w <= 0 || h <= 0) {
            onReady.run();
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            final Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            try {
                PixelCopy.request(getWindow(), bmp, new PixelCopy.OnPixelCopyFinishedListener() {
                    @Override public void onPixelCopyFinished(int result) {
                        if (result == PixelCopy.SUCCESS) {
                            snapshot = bmp;
                        } else {
                            bmp.recycle();
                            snapshot = null;
                        }
                        onReady.run();
                    }
                }, new Handler(Looper.getMainLooper()));
            } catch (Exception e) {
                bmp.recycle();
                snapshot = null;
                onReady.run();
            }
        } else {
            Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            try {
                Canvas canvas = new Canvas(bmp);
                decor.draw(canvas);
                snapshot = bmp;
            } catch (Exception e) {
                bmp.recycle();
                snapshot = null;
            }
            onReady.run();
        }
    }

    private void showOverlayAndAnimate(float cxFrac, float cyFrac, final boolean dark) {
        final View decor = getWindow().getDecorView();
        final int w = decor.getWidth(), h = decor.getHeight();
        final float cx = Math.max(0, Math.min(w, cxFrac * w));
        final float cy = Math.max(0, Math.min(h, cyFrac * h));

        overlay = new RevealOverlayView(this);
        overlay.setSnapshot(snapshot);
        overlay.setCenter(cx, cy);
        overlay.setRadius(0f);
        ((ViewGroup) decor).addView(overlay, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // 遮罩之下一次性切主题（不重建 Activity、不触发布局变化）
        applyThemeInstant(dark);

        // 下一帧再起动画：确保新主题已经完成一次绘制
        decor.post(new Runnable() {
            @Override public void run() {
                final float density = getResources().getDisplayMetrics().density;
                float r = 0f;
                r = Math.max(r, (float) Math.hypot(cx, cy));
                r = Math.max(r, (float) Math.hypot(w - cx, cy));
                r = Math.max(r, (float) Math.hypot(cx, h - cy));
                r = Math.max(r, (float) Math.hypot(w - cx, h - cy));
                final float maxR = r + 8f * density;   // 8dp 余量

                ValueAnimator anim = ValueAnimator.ofFloat(0f, maxR);
                anim.setDuration(REVEAL_MS);
                anim.setInterpolator(new PathInterpolator(0.32f, 0.72f, 0f, 1f));
                anim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                    @Override public void onAnimationUpdate(ValueAnimator a) {
                        if (overlay != null) overlay.setRadius((Float) a.getAnimatedValue());
                    }
                });
                anim.addListener(new AnimatorListenerAdapter() {
                    private boolean finished;

                    @Override public void onAnimationEnd(Animator a) { finish(); }
                    @Override public void onAnimationCancel(Animator a) { finish(); }

                    private void finish() {
                        if (finished) return;
                        finished = true;
                        cleanupReveal();
                    }
                });
                revealAnimator = anim;
                anim.start();
            }
        });
    }

    private void cleanupReveal() {
        if (overlay != null) {
            ViewGroup parent = (ViewGroup) overlay.getParent();
            if (parent != null) parent.removeView(overlay);
            overlay.release();
            overlay = null;
        }
        if (snapshot != null) {
            if (!snapshot.isRecycled()) snapshot.recycle();
            snapshot = null;
        }
        revealAnimator = null;
        isSwitching = false;
        pauseWebUi(false);
    }

    private void persistTheme(boolean dark) {
        getSharedPreferences(PREF, MODE_PRIVATE).edit().putBoolean(K_THEME, dark).apply();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applySystemBars();
        pushThemeTokens();
    }

    private void toast(final String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    /* ============================================================
     * JS 桥
     * ============================================================ */
    private class Bridge {

        @JavascriptInterface
        public boolean isNotificationAvailable() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                return checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                        == PackageManager.PERMISSION_GRANTED;
            }
            return true;
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            root.post(new Runnable() {
                @Override public void run() { ensureNotificationPermission(); }
            });
        }

        @JavascriptInterface
        public void notify(final String title, final String body) {
            root.post(new Runnable() {
                @Override public void run() {
                    Notifications.show(MainActivity.this, title, body);
                }
            });
        }

        @JavascriptInterface
        public void vibrate() {
            root.post(new Runnable() {
                @Override public void run() { Notifications.vibrate(MainActivity.this); }
            });
        }

        @JavascriptInterface
        public void saveFile(final String filename, final String content) {
            root.post(new Runnable() {
                @Override public void run() {
                    Exporter.share(MainActivity.this, filename, content);
                }
            });
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public int sdkInt() {
            return Build.VERSION.SDK_INT;
        }

        @JavascriptInterface
        public String getThemeTokens() {
            return buildThemeTokens();
        }

        /** 网页层同步主题状态（不带动画，用于冷启动对齐）。 */
        @JavascriptInterface
        public void setNightMode(final boolean dark) {
            root.post(new Runnable() {
                @Override public void run() {
                    webDark = dark;
                    persistTheme(dark);
                    applySystemBars();
                }
            });
        }

        /** 圆形扩散切换：cxFrac/cyFrac 为按钮中心归一化坐标。 */
        @JavascriptInterface
        public void startThemeSwitch(final float cxFrac, final float cyFrac, final boolean dark) {
            root.post(new Runnable() {
                @Override public void run() {
                    startThemeReveal(cxFrac, cyFrac, dark);
                }
            });
        }

        @JavascriptInterface
        public boolean isDynamicColorSupported() {
            return supportsDynamicColor();
        }

        @JavascriptInterface
        public boolean isDynamicColorEnabled() {
            return dynamicEnabled;
        }

        /** 「我的」页开关：切换后重新下发调色板，并复用同一转场。 */
        @JavascriptInterface
        public void setDynamicColorEnabled(final boolean enabled, final float cxFrac, final float cyFrac) {
            root.post(new Runnable() {
                @Override public void run() {
                    if (enabled == dynamicEnabled) return;
                    dynamicEnabled = enabled && supportsDynamicColor();
                    getSharedPreferences(PREF, MODE_PRIVATE).edit()
                            .putBoolean(K_DYNAMIC, dynamicEnabled).apply();
                    pushThemeTokens();
                    // 复用同一转场，圆心取开关中心
                    startThemeReveal(cxFrac, cyFrac, webDark, true);
                }
            });
        }

        @JavascriptInterface
        public float animationScale() {
            try {
                return Settings.Global.getFloat(getContentResolver(),
                        Settings.Global.ANIMATOR_DURATION_SCALE, 1f);
            } catch (Exception e) {
                return 1f;
            }
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (webView != null) webView.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return window.__onBackPressed?window.__onBackPressed():false;}"
                        + "catch(e){return false;}})()",
                new ValueCallback<String>() {
                    @Override public void onReceiveValue(String value) {
                        if (!"true".equals(value)) MainActivity.super.onBackPressed();
                    }
                });
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        applySystemBars();
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("window.__onResume && window.__onResume();", null);
            pushThemeTokens();
        }
    }

    @Override
    protected void onDestroy() {
        if (revealAnimator != null) {
            revealAnimator.cancel();
            revealAnimator = null;
        }
        cleanupReveal();
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidBridge");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
