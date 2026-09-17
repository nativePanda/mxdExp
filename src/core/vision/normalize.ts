/**
 * 字形归一化 —— 纯函数，零 DOM 依赖。
 *
 * 提供（架构 §2.5 / 预研 `exp2d_digits.js`）：
 * - `tightBBox`：紧致包围盒（在二值/灰度图上找前景范围）；
 * - `crop` / `cropBox`：按包围盒裁剪；
 * - `drawToCanvas`：缩放填充到 CANON 画布（最近邻采样）；
 * - `to01`：灰度 → 0/1 二值；
 * - `bboxBinary`：对已是 {0,1} 的二值子图裁紧致框。
 */

import type { BBox } from '@/types';
import type { BinaryImage } from './binarize';

/** 通用二维数组图（灰度或二值），`data` 为行优先。 */
export interface GrayImage {
  /** 宽度（px）。 */
  w: number;
  /** 高度（px）。 */
  h: number;
  /** 数据（行优先），长度 = `w * h`。 */
  data: Float64Array;
}

/**
 * 在图上求**紧致包围盒**（前景 = `data > bgThr`）。
 *
 * @param img 图（灰度或二值）。
 * @param bgThr 背景阈值；`> bgThr` 视为前景。
 * @returns 包围盒；无前景时返回 `null`。
 */
export function tightBBox(img: GrayImage, bgThr: number): BBox | null {
  const { w, h, data } = img;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = -1;
  let y1 = -1;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (data[row + x] > bgThr) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }

  if (x1 < 0 || y1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * 按整数包围盒裁剪图。
 *
 * 越界坐标按边界钳制（不会抛错）。
 *
 * @param img 图。
 * @param box 包围盒（px）。
 * @returns 裁剪后的新图。
 */
export function cropBox(img: GrayImage, box: BBox): GrayImage {
  const x0 = Math.max(0, Math.min(box.x, Math.max(0, img.w - 1)));
  const y0 = Math.max(0, Math.min(box.y, Math.max(0, img.h - 1)));
  const w = Math.max(1, Math.min(box.w, img.w - x0));
  const h = Math.max(1, Math.min(box.h, img.h - y0));

  const data = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      data[y * w + x] = img.data[(y0 + y) * img.w + (x0 + x)];
    }
  }
  return { w, h, data };
}

/**
 * 按左上角 + 尺寸裁剪图（`segment.ts` 用）。
 *
 * @param img 图。
 * @param sx 起始 x。
 * @param sw 宽度。
 * @returns 裁剪后的新图（高度不变）。
 */
export function crop(img: GrayImage, sx: number, sw: number): GrayImage {
  return cropBox(img, { x: sx, y: 0, w: sw, h: img.h });
}

/**
 * 灰度图 → 0/1 二值图（`> bgThr` 判前景）。
 *
 * @param img 灰度图。
 * @param bgThr 阈值，默认 40（与预研一致）。
 * @returns 二值图。
 */
export function to01(img: GrayImage, bgThr = 40): BinaryImage {
  const data = new Float64Array(img.w * img.h);
  for (let i = 0; i < data.length; i++) {
    data[i] = img.data[i] > bgThr ? 1 : 0;
  }
  return { w: img.w, h: img.h, data };
}

/**
 * 对已是 {0,1} 的二值子图裁**紧致框**（前景 = `> 0`）。
 *
 * 注意：二值图不能用 `to01` 的 40 阈值，必须用 0（预研 `bboxBinary` 的坑）。
 *
 * @param img 二值图。
 * @returns 裁剪后的新二值图；无前景时返回 `null`。
 */
export function bboxBinary(img: BinaryImage): BinaryImage | null {
  const b = tightBBox(img, 0);
  if (!b) return null;
  return cropBox(img, b);
}

/**
 * 把图**缩放填充**到固定画布 `cw × ch`（最近邻采样）。
 *
 * 这是跨分辨率/跨字号的归一化关键：不同尺寸的字形统一到同一画布后，
 * NCC 才能比较（预研实测 s2/s3/s4 互认全过）。
 *
 * @param img 输入图（任意尺寸）。
 * @param cw 目标画布宽。
 * @param ch 目标画布高。
 * @returns 缩放后的新图（`cw × ch`）。
 */
export function drawToCanvas(img: GrayImage, cw: number, ch: number): GrayImage {
  const out = new Float64Array(cw * ch);
  if (cw <= 0 || ch <= 0) return { w: cw, h: ch, data: out };
  const sx = img.w / cw;
  const sy = img.h / ch;
  for (let y = 0; y < ch; y++) {
    const py = Math.min(img.h - 1, Math.floor((y + 0.5) * sy));
    for (let x = 0; x < cw; x++) {
      const px = Math.min(img.w - 1, Math.floor((x + 0.5) * sx));
      out[y * cw + x] = img.data[py * img.w + px];
    }
  }
  return { w: cw, h: ch, data: out };
}

/**
 * 由裁剪框构造一个 `GrayImage`（对 `PixelSource` 灰度化 + 裁剪的便捷入口）。
 *
 * @param grayData 整帧灰度数据（长度 = `srcW * srcH`）。
 * @param srcW 整帧宽度。
 * @param box 裁剪框（px）。
 * @returns 裁剪后的灰度图。
 */
export function grayFromBox(grayData: Float64Array, srcW: number, box: BBox): GrayImage {
  const data = new Float64Array(box.w * box.h);
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      data[y * box.w + x] = grayData[(box.y + y) * srcW + (box.x + x)];
    }
  }
  return { w: box.w, h: box.h, data };
}
