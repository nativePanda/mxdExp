/**
 * 列剖面（单帧） —— 纯函数，零 DOM 依赖。
 *
 * 算法（预研 §9.2）：逐列取 `rect` 高度范围内所有像素的 `fillness`，
 * **排序后取 30 分位**，得到一条列剖面。
 *
 * 为什么用 30 分位而非中值：经验条上的白色数字（高 fillness）叠印在填充区上，
 * 取低分位可把白字压掉，得到"填充本身"的判别量（预研实验 C）。
 */

import type { ExpBarProfile, RegionRect } from '@/types';
import { fillness } from './color';

/**
 * 把区域矩形解析为**整数像素矩形**。
 *
 * 约定：`core/` 内的所有函数接收的 `RegionRect` 可能是
 * - 归一化坐标（0–1，相对整帧），或
 * - 像素坐标（已由 `FrameGrabber` 换算过）。
 *
 * 这里用启发式判定：若 `x`、`y`、`w`、`h` 全部 ≤ 1（含 0），按归一化处理并乘 `srcW/srcH`；
 * 否则视为像素坐标。这样调用方既可传归一化框（直接来自 `CalibrationConfig`），
 * 也可传已裁剪帧上的相对框（像素）。
 *
 * @param rect 区域矩形。
 * @param srcW 像素源宽度。
 * @param srcH 像素源高度。
 * @returns 裁剪到像素源范围内的整数像素矩形 `{x,y,w,h}`。
 */
export function resolveRectPixels(
  rect: RegionRect,
  srcW: number,
  srcH: number,
): { x: number; y: number; w: number; h: number } {
  const isNormalized =
    rect.x <= 1 && rect.y <= 1 && rect.w <= 1 && rect.h <= 1 && rect.w > 0 && rect.h > 0;

  let px: number;
  let py: number;
  let pw: number;
  let ph: number;

  if (isNormalized) {
    px = Math.round(rect.x * srcW);
    py = Math.round(rect.y * srcH);
    pw = Math.round(rect.w * srcW);
    ph = Math.round(rect.h * srcH);
  } else {
    px = Math.round(rect.x);
    py = Math.round(rect.y);
    pw = Math.round(rect.w);
    ph = Math.round(rect.h);
  }

  px = Math.max(0, Math.min(px, Math.max(0, srcW - 1)));
  py = Math.max(0, Math.min(py, Math.max(0, srcH - 1)));
  pw = Math.max(1, Math.min(pw, srcW - px));
  ph = Math.max(1, Math.min(ph, srcH - py));

  return { x: px, y: py, w: pw, h: ph };
}

/**
 * 计算单帧经验条的逐列剖面。
 *
 * @param src 像素源（通常是完整帧或已裁剪的帧）。
 * @param rect 经验条区域（归一化坐标或像素坐标，见 `resolveRectPixels`）。
 * @param percentile 分位数（0–1），默认 0.3。取 30 分位以压掉叠印在条上的白色数字。
 * @returns 逐列 fillness 剖面的 `ExpBarProfile`。
 */
export function columnProfile(
  src: { width: number; height: number; data: Uint8ClampedArray | Uint8Array },
  rect: RegionRect,
  percentile = 0.3,
): ExpBarProfile {
  const box = resolveRectPixels(rect, src.width, src.height);
  const w = box.w;
  const h = box.h;
  const columns = new Float64Array(w);

  const p = Number.isFinite(percentile) ? Math.min(Math.max(percentile, 0), 1) : 0.3;

  const vals = new Float64Array(h);
  for (let dx = 0; dx < w; dx++) {
    const x = box.x + dx;
    for (let dy = 0; dy < h; dy++) {
      const y = box.y + dy;
      const i = (src.width * y + x) << 2;
      vals[dy] = fillness(src.data[i], src.data[i + 1], src.data[i + 2]);
    }
    columns[dx] = quantile(vals, h, p);
  }

  return { columns, width: w };
}

/**
 * 对前 `len` 个元素排序后取分位值（在副本上排序，不改动调用方数据）。
 *
 * @param values 待取分位的数组（长度 ≥ len）。
 * @param len 有效长度。
 * @param percentile 分位数（0–1）。
 * @returns 分位值；`len <= 0` 时返回 0。
 */
export function quantile(values: Float64Array, len: number, percentile: number): number {
  if (len <= 0) return 0;
  const copy = values.slice(0, len);
  copy.sort();
  const idx = Math.min(len - 1, Math.max(0, Math.floor(len * percentile)));
  return copy[idx];
}
