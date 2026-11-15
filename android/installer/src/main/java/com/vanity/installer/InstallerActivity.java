package com.vanity.installer;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Downloads the newest Vanity from GitHub Releases and asks Android to install it.
 * The addresses below always point at the latest release, so this app never goes out of date.
 */
public class InstallerActivity extends Activity {

    private static final String VANITY = "com.vanity.launcher";
    private static final String RELEASES = "https://github.com/NoVanity99/Vanity/releases/latest/download/";
    private static final String APK_URL = RELEASES + "Vanity.apk";
    private static final String VERSION_URL = RELEASES + "latest.yml";

    private static final int ACCENT = Color.rgb(0xDF, 0x40, 0x55);
    private static final int TEXT = Color.rgb(0xF2, 0xF3, 0xF7);
    private static final int MUTED = Color.rgb(0x9A, 0xA0, 0xB0);

    private TextView status;
    private TextView detail;
    private ProgressBar bar;
    private Button button;

    private volatile boolean working = false;
    /** The downloaded APK, once it is complete and checked. */
    private File ready;
    private long readyVersion = -1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildView());
        start();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Back from Android's install screen: if Vanity is now in place, offer to open it.
        if (!working && ready != null && installedVersion() >= readyVersion) showInstalled();
    }

    // ---- screen ----

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private View buildView() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(32), dp(32), dp(32), dp(32));
        root.setFitsSystemWindows(true);

        ImageView icon = new ImageView(this);
        icon.setImageResource(R.mipmap.ic_launcher);
        root.addView(icon, new LinearLayout.LayoutParams(dp(96), dp(96)));

        TextView title = new TextView(this);
        title.setText("Vanity");
        title.setTextColor(TEXT);
        title.setTextSize(30);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        titleLp.topMargin = dp(20);
        root.addView(title, titleLp);

        status = new TextView(this);
        status.setTextColor(TEXT);
        status.setTextSize(17);
        status.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams statusLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        statusLp.topMargin = dp(28);
        root.addView(status, statusLp);

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setProgressTintList(ColorStateList.valueOf(ACCENT));
        bar.setIndeterminateTintList(ColorStateList.valueOf(ACCENT));
        LinearLayout.LayoutParams barLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        barLp.topMargin = dp(16);
        root.addView(bar, barLp);

        detail = new TextView(this);
        detail.setTextColor(MUTED);
        detail.setTextSize(14);
        detail.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams detailLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        detailLp.topMargin = dp(12);
        root.addView(detail, detailLp);

        button = new Button(this);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setTextSize(16);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(ACCENT);
        bg.setCornerRadius(dp(14));
        button.setBackground(bg);
        button.setStateListAnimator(null);
        button.setVisibility(View.GONE);
        LinearLayout.LayoutParams buttonLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
        buttonLp.topMargin = dp(28);
        root.addView(button, buttonLp);

        return root;
    }

    private void show(String statusText, String detailText) {
        status.setText(statusText);
        detail.setText(detailText == null ? "" : detailText);
    }

    private void showButton(String label, View.OnClickListener onClick) {
        button.setText(label);
        button.setOnClickListener(onClick);
        button.setVisibility(View.VISIBLE);
    }

    private void showInstalled() {
        bar.setVisibility(View.INVISIBLE);
        show("Vanity is installed", "You can remove Vanity Installer now. Vanity keeps itself up to date.");
        showButton("Open Vanity", v -> openVanity());
    }

    private void showError(String message) {
        bar.setVisibility(View.INVISIBLE);
        show("Couldn't download Vanity", message);
        showButton("Try again", v -> start());
    }

    // ---- work ----

    private long installedVersion() {
        try {
            return PackageInfoCompat.getLongVersionCode(getPackageManager().getPackageInfo(VANITY, 0));
        } catch (PackageManager.NameNotFoundException e) {
            return -1;
        }
    }

    private String installedVersionName() {
        try {
            return getPackageManager().getPackageInfo(VANITY, 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return null;
        }
    }

    private void openVanity() {
        Intent open = getPackageManager().getLaunchIntentForPackage(VANITY);
        if (open == null) {
            start();
            return;
        }
        startActivity(open);
        finish();
    }

    private void start() {
        if (working) return;
        working = true;
        ready = null;
        button.setVisibility(View.GONE);
        bar.setVisibility(View.VISIBLE);
        bar.setIndeterminate(true);
        show("Looking for the newest version…", null);

        new Thread(() -> {
            try {
                // The version is only for showing; the download works without it.
                String latest = null;
                try {
                    Matcher m = Pattern.compile("(?m)^version:\\s*(\\S+)").matcher(fetchText(VERSION_URL));
                    if (m.find()) latest = m.group(1);
                } catch (Exception ignored) {
                }
                final String version = latest;

                if (version != null && version.equals(installedVersionName())) {
                    runOnUiThread(() -> {
                        working = false;
                        bar.setVisibility(View.INVISIBLE);
                        show("Vanity " + version + " is already installed", "That is the newest version.");
                        showButton("Open Vanity", v -> openVanity());
                    });
                    return;
                }

                final String what = version == null ? "Downloading Vanity…" : "Downloading Vanity " + version + "…";
                runOnUiThread(() -> show(what, null));

                File dir = new File(getCacheDir(), "download");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                File apk = new File(dir, "Vanity.apk");
                download(APK_URL, apk);

                PackageInfo info = getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
                if (info == null || !VANITY.equals(info.packageName)) throw new IllegalStateException("The downloaded file is not Vanity.");
                final long code = PackageInfoCompat.getLongVersionCode(info);
                final String name = info.versionName;

                runOnUiThread(() -> {
                    working = false;
                    ready = apk;
                    readyVersion = code;
                    bar.setIndeterminate(false);
                    bar.setProgress(100);
                    show("Vanity " + name + " is ready", "Tap Install. If Android asks, allow Vanity Installer to install apps, then come back.");
                    showButton("Install", v -> install());
                    install();
                });
            } catch (Exception e) {
                final String message = e instanceof IllegalStateException && e.getMessage() != null ? e.getMessage() : "Check your internet connection and try again.";
                runOnUiThread(() -> {
                    working = false;
                    showError(message);
                });
            }
        }, "vanity-download").start();
    }

    private void install() {
        if (ready == null || !ready.exists()) {
            start();
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", ready);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(intent);
        } catch (Exception e) {
            showError("Android couldn't open the installer on this phone.");
        }
    }

    private HttpURLConnection open(String address) throws Exception {
        // GitHub answers with a redirect to its download servers. Follow by hand so every hop is https.
        String next = address;
        for (int hop = 0; ; hop++) {
            if (!next.startsWith("https://")) throw new IllegalStateException("The download address is not secure.");
            HttpURLConnection conn = (HttpURLConnection) new URL(next).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(20_000);
            conn.setReadTimeout(30_000);
            conn.setRequestProperty("User-Agent", "Vanity-Installer-Android");
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400 && hop < 5) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null) throw new IllegalStateException("The download server gave no address.");
                next = new URL(new URL(next), location).toString();
                continue;
            }
            if (code != 200) {
                conn.disconnect();
                throw new IllegalStateException("The download server answered with error " + code + ".");
            }
            return conn;
        }
    }

    private String fetchText(String address) throws Exception {
        HttpURLConnection conn = open(address);
        try (InputStream in = conn.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1 && out.size() < 1_000_000) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } finally {
            conn.disconnect();
        }
    }

    private void download(String address, File target) throws Exception {
        File part = new File(target.getPath() + ".part");
        HttpURLConnection conn = open(address);
        try {
            final long total = conn.getContentLengthLong();
            long done = 0;
            int last = -1;
            byte[] buf = new byte[64 * 1024];
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    done += n;
                    if (total > 0) {
                        final int percent = (int) (done * 100 / total);
                        if (percent != last) {
                            last = percent;
                            final String mb = String.format(java.util.Locale.US, "%.1f of %.1f MB", done / 1048576.0, total / 1048576.0);
                            runOnUiThread(() -> {
                                bar.setIndeterminate(false);
                                bar.setProgress(percent);
                                detail.setText(mb);
                            });
                        }
                    }
                }
            }
            if (total > 0 && done != total) throw new IllegalStateException("The download was cut off. Try again.");
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            if (!part.renameTo(target)) throw new IllegalStateException("Couldn't save the download. Free up some space and try again.");
        } finally {
            conn.disconnect();
            //noinspection ResultOfMethodCallIgnored
            part.delete();
        }
    }
}
