package com.taskflow.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.Charset;

/**
 * 导出备份文件。
 *
 * 两条路径，按系统版本选择，都不依赖 AndroidX：
 *  - API 29+ (Q)：写入「下载」集合（MediaStore），无需任何存储权限，
 *    文件直接出现在系统的 Downloads 目录，用户可见。
 *  - API 28 及以下：写入应用外部私有目录，再用 FileProvider 分享。
 *    为免引入 AndroidX，这里退化为写入应用私有目录并提示路径。
 */
final class Exporter {

    private Exporter() {}

    static void share(Context ctx, String filename, String content) {
        String name = sanitize(filename);
        byte[] data = (content == null ? "{}" : content).getBytes(Charset.forName("UTF-8"));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (writeToDownloads(ctx, name, data)) return;
        }
        writeToAppDir(ctx, name, data);
    }

    private static String sanitize(String filename) {
        String n = (filename == null || filename.trim().isEmpty())
                ? "taskflow-backup.json" : filename;
        return n.replaceAll("[/\\\\:*?\"<>|]", "_");
    }

    /** API 29+：写入系统下载目录，无需权限，用户可在文件管理器直接看到。 */
    private static boolean writeToDownloads(Context ctx, String name, byte[] data) {
        try {
            android.content.ContentValues cv = new android.content.ContentValues();
            cv.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name);
            cv.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "application/json");
            cv.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS);

            android.content.ContentResolver cr = ctx.getContentResolver();
            Uri item = cr.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            if (item == null) return false;

            try (OutputStream os = cr.openOutputStream(item)) {
                if (os == null) return false;
                os.write(data);
                os.flush();
            }
            toast(ctx, "已导出到「下载」：" + name);
            return true;
        } catch (Throwable t) {
            return false;   // 落到下一条路径
        }
    }

    /** 兜底：写入应用外部私有目录，并用分享面板让用户转存。 */
    private static void writeToAppDir(Context ctx, String name, byte[] data) {
        try {
            File dir = ctx.getExternalFilesDir(null);
            if (dir == null) dir = ctx.getFilesDir();
            File out = new File(dir, name);
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(data);
                fos.flush();
            }

            Uri uri = Uri.fromFile(out);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/json");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, name);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(send, "保存 / 分享备份文件");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(chooser);
        } catch (Throwable t) {
            toast(ctx, "导出失败：" + t.getMessage());
        }
    }

    private static void toast(Context ctx, String msg) {
        try {
            Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show();
        } catch (Throwable ignored) {}
    }
}
