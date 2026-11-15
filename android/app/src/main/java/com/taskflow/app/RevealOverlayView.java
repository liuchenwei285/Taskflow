package com.taskflow.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Path;
import android.graphics.Region;
import android.os.Build;
import android.view.View;

/**
 * 主题切换的「快照遮罩」。
 *
 * 只画一张整屏位图，并在画面中挖掉一个以按钮中心为圆心、半径随动画增长的圆：
 * 圆内露出遮罩之下已经切换好的新主题，圆外仍是旧主题快照。
 *
 * 设计约束（性能）：
 *  - 没有子 View，不参与测量/布局；
 *  - onDraw 只做一次 drawBitmap + 一次裁剪，不产生额外图层；
 *  - API 26+ 用 clipOutPath（硬件加速原生支持）；
 *    API 24–25 硬件层不支持 clipPath(DIFFERENCE)，改走软件层保证挖洞正确。
 */
public class RevealOverlayView extends View {

    private Bitmap snapshot;
    private final Path hole = new Path();
    private float cx;
    private float cy;
    private float radius;

    public RevealOverlayView(Context context) {
        super(context);
        setClickable(true);      // 动画期间吞掉触摸，防止连点与滚动
        setFocusable(false);
        if (Build.VERSION.SDK_INT < 26) {
            setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        }
    }

    public void setSnapshot(Bitmap bitmap) {
        snapshot = bitmap;
        invalidate();
    }

    public void setCenter(float x, float y) {
        cx = x;
        cy = y;
    }

    public void setRadius(float r) {
        radius = r;
        invalidate();
    }

    @SuppressLint("NewApi")
    @Override
    protected void onDraw(Canvas canvas) {
        Bitmap b = snapshot;
        if (b == null || b.isRecycled()) return;

        hole.reset();
        hole.addCircle(cx, cy, Math.max(0f, radius), Path.Direction.CW);

        int save = canvas.save();
        if (Build.VERSION.SDK_INT >= 26) {
            canvas.clipOutPath(hole);
        } else {
            canvas.clipPath(hole, Region.Op.DIFFERENCE);
        }
        canvas.drawBitmap(b, 0f, 0f, null);
        canvas.restoreToCount(save);
    }

    /** 摘掉位图引用，便于外层立即 recycle。 */
    public void release() {
        snapshot = null;
        hole.reset();
    }
}
