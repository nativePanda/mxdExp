/**
 * 颜色空间工具 —— 识别内核的**颜色约定唯一定义处**。
 *
 * 硬约定（架构文档 §5.5）：
 * - 一律以 RGB（0–255）处理，`ImageData.data` 原生 RGBA，Alpha 通道忽略。
 * - `fillness(r,g,b) = r - 1.2*b + 0.2*g` 是**唯一实现**（经验条橙黄填充 vs 深棕底区分度最大），
 *   **禁止**在其他文件重复写这个公式。
 * - 灰度化公式 `gray = 0.299r + 0.587g + 0.114b` 同样**单点定义**在本文件。
 *
 * 本文件为**纯 TypeScript**：零 DOM、零 Vue 依赖，可在 Node 下直接单测。
 */

import type { PixelSource } from '@/types';

/**
 * 「填充度」判别量：橙黄填充与深棕底色的区分度最大。
 *
 * 公式：`fillness(r,g,b) = r - 1.2*b + 0.2*g`。
 *
 * 直觉：橙黄填充 r 高、b 低 → 值大；深棕底 r 低、b 略高 → 值小。
 *
 * @param r 红通道（0–255）。
 * @param g 绿通道（0–255）。
 * @param b 蓝通道（0–255）。
 * @returns 填充度判别量（可正可负，量纲无关，仅用于相对比较）。
 */
export function fillness(r: number, g: number, b: number): number {
  return r - 1.2 * b + 0.2 * g;
}

/**
 * 灰度化：`gray = 0.299r + 0.587g + 0.114b`。
 *
 * 这是**全局唯一的灰度公式定义处**（架构 §5.5），文字识别链路一律经此函数。
 *
 * @param r 红通道（0–255）。
 * @param g 绿通道（0–255）。
 * @param b 蓝通道（0–255）。
 * @returns 灰度值（0–255）。
 */
export function gray(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * 读取 `PixelSource` 上某一像素的 RGB 三元组。
 *
 * 越界坐标返回 `null`（而非抛错），便于调用方容错处理。
 *
 * @param src 像素源。
 * @param x 横坐标（px）。
 * @param y 纵坐标（px）。
 * @returns `[r,g,b]` 或越界时的 `null`。
 */
export function pixelAt(
  src: PixelSource,
  x: number,
  y: number,
): [number, number, number] | null {
  if (x < 0 || y < 0 || x >= src.width || y >= src.height) return null;
  const i = (src.width * y + x) << 2;
  return [src.data[i], src.data[i + 1], src.data[i + 2]];
}

/**
 * 读取 `PixelSource` 上某一像素的「填充度」。
 *
 * 越界坐标返回 `null`。
 *
 * @param src 像素源。
 * @param x 横坐标（px）。
 * @param y 纵坐标（px）。
 * @returns fillness 值或越界时的 `null`。
 */
export function fillnessAt(src: PixelSource, x: number, y: number): number | null {
  const p = pixelAt(src, x, y);
  return p === null ? null : fillness(p[0], p[1], p[2]);
}

/**
 * 读取 `PixelSource` 上某一像素的灰度值。
 *
 * 越界坐标返回 `null`。
 *
 * @param src 像素源。
 * @param x 横坐标（px）。
 * @param y 纵坐标（px）。
 * @returns 灰度值或越界时的 `null`。
 */
export function grayAt(src: PixelSource, x: number, y: number): number | null {
  const p = pixelAt(src, x, y);
  return p === null ? null : gray(p[0], p[1], p[2]);
}
