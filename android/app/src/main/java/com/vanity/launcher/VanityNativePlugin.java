package com.vanity.launcher;

import android.Manifest;
import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.ContentUris;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.MediaStore;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;

import java.io.File;
import java.io.FileOutputStream;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The Android side of Vanity. The web side of this contract is src/mobile/native.ts:
 * keep the two in step.
 */
@CapacitorPlugin(
    name = "VanityNative",
    permissions = {
        @Permission(alias = "audio", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class VanityNativePlugin extends Plugin {

    /** Icons are drawn at this size (pixels): sharp on a phone grid without being heavy. */
    private static final int ICON_SIZE = 256;
    /** Leaving a game for less than this (a notification, the app switcher) doesn't end the session. */
    private static final long SESSION_GAP_MS = 60_000;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    // ---- apps ----

    @PluginMethod
    public void listApps(PluginCall call) {
        worker.execute(() -> {
            try {
                Context ctx = getContext();
                PackageManager pm = ctx.getPackageManager();
                Intent main = new Intent(Intent.ACTION_MAIN);
                main.addCategory(Intent.CATEGORY_LAUNCHER);
                List<ResolveInfo> found = pm.queryIntentActivities(main, 0);

                File iconDir = new File(ctx.getFilesDir(), "icons");
                //noinspection ResultOfMethodCallIgnored
                iconDir.mkdirs();

                JSArray apps = new JSArray();
                Set<String> seen = new HashSet<>();
                for (ResolveInfo info : found) {
                    if (info.activityInfo == null) continue;
                    String pkg = info.activityInfo.packageName;
                    if (pkg == null || pkg.equals(ctx.getPackageName()) || !seen.add(pkg)) continue;
                    try {
                        ApplicationInfo app = pm.getApplicationInfo(pkg, 0);
                        PackageInfo pkgInfo = pm.getPackageInfo(pkg, 0);
                        JSObject o = new JSObject();
                        o.put("packageName", pkg);
                        o.put("name", String.valueOf(pm.getApplicationLabel(app)));
                        o.put("isGame", isGame(app));
                        o.put("installedAt", pkgInfo.firstInstallTime);
                        String icon = saveIcon(pm, app, iconDir, pkgInfo.lastUpdateTime);
                        o.put("icon", icon == null ? JSObject.NULL : icon);
                        apps.put(o);
                    } catch (Exception e) {
                        // An app that vanished mid-scan, or one we can't read: skip it.
                    }
                }
                JSObject res = new JSObject();
                res.put("apps", apps);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Could not list the apps on this phone", e);
            }
        });
    }

    @SuppressWarnings("deprecation")
    private static boolean isGame(ApplicationInfo app) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && app.category == ApplicationInfo.CATEGORY_GAME) return true;
        return (app.flags & ApplicationInfo.FLAG_IS_GAME) != 0;
    }

    /** Saves the app's icon as a PNG (once per app version) and returns its file:// address. */
    private static String saveIcon(PackageManager pm, ApplicationInfo app, File dir, long updatedAt) {
        try {
            File file = new File(dir, app.packageName + ".png");
            if (!file.exists() || file.lastModified() < updatedAt) {
                Drawable d = pm.getApplicationIcon(app);
                Bitmap bmp = Bitmap.createBitmap(ICON_SIZE, ICON_SIZE, Bitmap.Config.ARGB_8888);
                Canvas canvas = new Canvas(bmp);
                d.setBounds(0, 0, ICON_SIZE, ICON_SIZE);
                d.draw(canvas);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
                }
                bmp.recycle();
            }
            return Uri.fromFile(file).toString();
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void launch(PluginCall call) {
        String pkg = call.getString("packageName");
        if (pkg == null || pkg.isEmpty()) {
            call.reject("No app given");
            return;
        }
        try {
            Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
            if (intent == null) {
                call.reject("That game is no longer installed");
                return;
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not start the game", e);
        }
    }

    // ---- playtime (Android's "Usage access") ----

    private boolean hasUsageAccess() {
        try {
            Context ctx = getContext();
            AppOpsManager ops = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
            int mode;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.getPackageName());
            } else {
                //noinspection deprecation
                mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.getPackageName());
            }
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void usageAccess(PluginCall call) {
        JSObject res = new JSObject();
        res.put("granted", hasUsageAccess());
        call.resolve(res);
    }

    @PluginMethod
    public void openUsageSettings(PluginCall call) {
        Context ctx = getContext();
        try {
            // Straight to Vanity's own switch where the phone supports it.
            Intent direct = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:" + ctx.getPackageName()));
            direct.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(direct);
            call.resolve();
        } catch (Exception first) {
            try {
                Intent list = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
                list.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(list);
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not open the Usage access settings", e);
            }
        }
    }

    @PluginMethod
    public void usage(PluginCall call) {
        Double sinceArg = call.getDouble("since");
        JSArray pkgArg = call.getArray("packages");
        if (sinceArg == null || pkgArg == null) {
            call.reject("since and packages are required");
            return;
        }
        final long since = sinceArg.longValue();
        final Set<String> wanted = new HashSet<>();
        try {
            JSONArray arr = pkgArg;
            for (int i = 0; i < arr.length(); i++) wanted.add(arr.getString(i));
        } catch (JSONException e) {
            call.reject("packages must be a list of app names");
            return;
        }

        worker.execute(() -> {
            JSArray sessions = new JSArray();
            JSObject res = new JSObject();
            res.put("sessions", sessions);
            if (!hasUsageAccess() || wanted.isEmpty()) {
                call.resolve(res);
                return;
            }
            try {
                long now = System.currentTimeMillis();
                UsageStatsManager usm = (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
                UsageEvents events = usm.queryEvents(since, now);
                Map<String, long[]> open = new HashMap<>(); // package -> { start, lastPause }
                UsageEvents.Event ev = new UsageEvents.Event();
                while (events.hasNextEvent()) {
                    events.getNextEvent(ev);
                    String pkg = ev.getPackageName();
                    if (pkg == null || !wanted.contains(pkg)) continue;
                    int type = ev.getEventType();
                    long t = ev.getTimeStamp();
                    // 1 = moved to the foreground, 2 = moved to the background (same numbers on every Android version).
                    if (type == 1) {
                        long[] s = open.get(pkg);
                        if (s == null) {
                            open.put(pkg, new long[] { t, 0 });
                        } else if (s[1] > 0 && t - s[1] > SESSION_GAP_MS) {
                            addSession(sessions, pkg, s[0], s[1]);
                            s[0] = t;
                            s[1] = 0;
                        } else {
                            s[1] = 0;
                        }
                    } else if (type == 2) {
                        long[] s = open.get(pkg);
                        if (s != null) s[1] = t;
                    }
                }
                for (Map.Entry<String, long[]> e : open.entrySet()) {
                    long[] s = e.getValue();
                    // Still on screen with no "left" event yet: it isn't finished, so it is counted next time.
                    if (s[1] > 0) addSession(sessions, e.getKey(), s[0], s[1]);
                }
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Could not read app usage", e);
            }
        });
    }

    private static void addSession(JSArray out, String pkg, long start, long end) {
        if (end <= start) return;
        JSObject o = new JSObject();
        o.put("packageName", pkg);
        o.put("start", start);
        o.put("end", end);
        out.put(o);
    }

    // ---- music ----

    private String audioAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "audio" : "storage";
    }

    @PluginMethod
    public void listMusic(PluginCall call) {
        if (getPermissionState(audioAlias()) == PermissionState.GRANTED) {
            readMusic(call);
        } else {
            requestPermissionForAlias(audioAlias(), call, "musicPermission");
        }
    }

    @PermissionCallback
    private void musicPermission(PluginCall call) {
        if (getPermissionState(audioAlias()) == PermissionState.GRANTED) {
            readMusic(call);
        } else {
            JSObject res = new JSObject();
            res.put("granted", false);
            res.put("tracks", new JSArray());
            call.resolve(res);
        }
    }

    private void readMusic(PluginCall call) {
        worker.execute(() -> {
            JSArray tracks = new JSArray();
            Uri collection = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
                : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
            String[] cols = {
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.ALBUM_ID
            };
            // Songs only: no ringtones, alarms or notification sounds.
            String where = MediaStore.Audio.Media.IS_MUSIC + " != 0";
            try (Cursor c = getContext().getContentResolver().query(collection, cols, where, null, MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC")) {
                if (c != null) {
                    int id = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                    int title = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
                    int artist = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
                    int album = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
                    int albumId = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID);
                    Uri artBase = Uri.parse("content://media/external/audio/albumart");
                    while (c.moveToNext()) {
                        JSObject o = new JSObject();
                        o.put("uri", ContentUris.withAppendedId(collection, c.getLong(id)).toString());
                        o.put("title", c.getString(title) == null ? "Unknown" : c.getString(title));
                        o.put("artist", known(c.getString(artist)));
                        o.put("album", known(c.getString(album)));
                        long aid = c.isNull(albumId) ? 0 : c.getLong(albumId);
                        o.put("art", aid > 0 ? ContentUris.withAppendedId(artBase, aid).toString() : JSObject.NULL);
                        tracks.put(o);
                    }
                }
                JSObject res = new JSObject();
                res.put("granted", true);
                res.put("tracks", tracks);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Could not read the music on this phone", e);
            }
        });
    }

    /** Android fills unknown artists and albums with "<unknown>". */
    private static Object known(String s) {
        return s == null || s.isEmpty() || s.equals(MediaStore.UNKNOWN_STRING) ? JSObject.NULL : s;
    }

    // ---- links ----

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("Only web addresses can be opened");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("No app on this phone can open that link", e);
        }
    }
}
