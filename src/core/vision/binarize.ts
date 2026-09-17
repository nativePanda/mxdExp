/**
 * 灰度化 + 二值化 —— 纯函数，零 DOM 依赖。
 *
 * 用途：数字模板匹配链路的前置步骤（预研 §3.2 / §9.4）。
 * 灰度公式**单点定义**在 `color.ts`（架构 §5.5）。
 */

import type { PixelSource } from '@/types';
import { gray } from './color';
import { otsu } from './otsu';

/** 二值图：`1` = 前景（亮字），`0` = 背景。 */
export interface BinaryImage {
  /** 宽度（px）。 */
  w: number;
  /** 高度（px）。 */
  h: number;
  /** 二值数据（0/1），长度 = `w * h`。 */
  data: Float64Array;
}

/**
 * 把 `PixelSource` 转灰度图。
 *
 * @param src 像素源。
 * @returns 灰度数据（0–255），长度 = `width * height`。
 */
export function toGray(src: PixelSource): Float64Array {
  const n = src.width * src.height;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = i << 2;
    out[i] = gray(src.data[j], src.data[j + 1], src.data[j + 2]);
  }
  return out;
}

/**
 * 灰度图 → 二值图（**前景 = 1**，即亮于阈值的像素）。
 *
 * 阈值来源：Otsu 自适应；退化（max === min）时取 `min + 1`，保证全部归 0（全背景）。
 *
 * @param src 像素源。
 * @returns `BinaryImage`。
 */
export function binarize(src: PixelSource): BinaryImage {
  const g = toGray(src);
  return binarizeGray(g, src.width, src.height);
}

/**
 * 灰度数据 → 二值图（前景 = 1）。
 *
 * ⚠️ 阈值策略（关键一致性要求）：数字模板匹配的**模板字形**与**待识别字形**
 * 必须使用**同一套二值化**，否则二者形状出现系统性差异，NCC 会异常偏低。
 *
 * 这里默认使用 **Otsu**。若 Otsu 退化为"仅前景两类"（例如整幅图只有字与背景两种
 * 亮度）时，Otsu 可能把**描边**（灰度介于背景与字之间）判为背景，使字形变细、
 * 甚至把一个字形切成两段（实测合成夹具的 `4` 会如此）。
 * 因此额外提供 `binarizeBand`（`min + ratio*(max-min)`）作为模板匹配链路的
 * **鲁棒替代**：它把背景、描边、字三者按比例分开，跨渲染管线更稳定。
 *
 * @param g 灰度数据（0–255），长度 = `w * h`。
 * @param w 宽度。
 * @param h 高度。
 * @returns `BinaryImage`。
 */
export function binarizeGray(g: Float64Array, w: number, h: number): BinaryImage {
  const out = new Float64Array(g.length);
  if (g.length === 0) return { w, h, data: out };

  let mn = Number.POSITIVE_INFINITY;
  let mx = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < g.length; i++) {
    if (g[i] < mn) mn = g[i];
    if (g[i] > mx) mx = g[i];
  }

  if (!Number.isFinite(mn) || !Number.isFinite(mx) || mx - mn < 1) {
    // 全同色调 → 全部视为背景。
    return { w, h, data: out };
  }

  const thr = otsu(g);
  for (let i = 0; i < g.length; i++) {
    out[i] = g[i] > thr ? 1 : 0;
  }
  return { w, h, data: out };
}

/**
 * 按「动态范围内的比例带」二值化（前景 = 1）。
 *
 * 阈值 = `mn + bandRatio * (mx - mn)`。
 *
 * 用途：数字模板匹配链路（模板与待识别图像**共用**）—— 相比 Otsu，它在"背景 / 描边 /
 * 字"三段式亮度分布下更稳定：把阈值取得**低于描边**，可保住描边、避免字形被切碎
 * （实测合成夹具的 `4`，描边亮度 ≈ 80/255 ≈ 0.31，若 bandRatio ≥ 0.31 描边被判背景，
 * 字形断成两段 → 分割错误）。
 *
 * @param g 灰度数据（0–255）。
 * @param w 宽度。
 * @param h 高度。
 * @param bandRatio 比例带（0–1），默认 0.25（低于典型描边 0.31，保住描边）。
 * @returns `BinaryImage`。
 */
export function binarizeBand(
  g: Float64Array,
  w: number,
  h: number,
  bandRatio = 0.25,
): BinaryImage {
  const out = new Float64Array(g.length);
  if (g.length === 0) return { w, h, data: out };

  let mn = Number.POSITIVE_INFINITY;
  let mx = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < g.length; i++) {
    if (g[i] < mn) mn = g[i];
    if (g[i] > mx) mx = g[i];
  }
  if (!Number.isFinite(mn) || !Number.isFinite(mx) || mx - mn < 1) {
    return { w, h, data: out };
  }

  const thr = mn + Math.min(Math.max(bandRatio, 0), 1) * (mx - mn);
  for (let i = 0; i < g.length; i++) {
    out[i] = g[i] > thr ? 1 : 0;
  }
  return { w, h, data: out };
}

/**
 * 用固定阈值二值化（前景 = 1）。用于 `tightBBox` 等已知量级场景。
 *
 * @param g 灰度数据（0–255）。
 * @param w 宽度。
 * @param h 高度。
 * @param thr 阈值；`> thr` 判为前景。
 * @returns `BinaryImage`。
 */
export function binarizeThreshold(g: Float64Array, w: number, h: number, thr: number): BinaryImage {
  const out = new Float64Array(g.length);
  for (let i = 0; i < g.length; i++) {
    out[i] = g[i] > thr ? 1 : 0;
  }
  return { w, h, data: out };
}
