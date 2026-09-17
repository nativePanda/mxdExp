/**
 * 字形分割（列投影谷值分割）—— 纯函数，零 DOM 依赖。
 *
 * 算法（预研 `exp2d_digits.js` / 技术预研 §3.2）：
 * 1. 逐列统计前景像素数 → 列投影；
 * 2. 找出 `col === 0` 的连续空白段作为**分隔**；
 * 3. 过宽段（> `maxCharW + 2.5`）用「模板宽度贪心切分」兜底；
 * 4. 过滤掉过窄的噪声段。
 *
 * 设计取舍：预研用严格的 `col === 0`；本实现额外支持「低投影谷」容差
 * （`allowHolePx`），用于数字带 1~2px 抗锯齿残留时仍能正确分割。
 */

import type { BinaryImage } from './binarize';

/** 一个字形段（列区间）。 */
export interface Segment {
  /** 起始列（含）。 */
  x: number;
  /** 段宽（列数）。 */
  w: number;
}

/** `splitByProjection` 的可选参数。 */
export interface SplitOptions {
  /**
   * 允许的"空洞"像素数：列投影 ≤ `allowHolePx` 即视为空白间隔。
   * 默认 0（严格，与预研一致）。设为 1~2 可容抗锯齿残留。
   */
  allowHolePx: number;
  /**
   * 最小段宽（列数），低于此值的段视为噪声丢弃。
   * 默认 1（不丢弃单列）；真实数字字形通常 ≥ 3px。
   */
  minSegW: number;
}

const DEFAULT_SPLIT: SplitOptions = { allowHolePx: 0, minSegW: 1 };

/**
 * 列投影分割字形。
 *
 * @param bin 二值图（前景 = 1）。
 * @param maxCharW 单字形最大宽度（过宽段按此贪心切分）。
 * @param opts 可选参数（`allowHolePx` / `minSegW`）。
 * @returns 字形段列表（按 x 升序）。
 */
export function splitByProjection(
  bin: BinaryImage,
  maxCharW: number,
  opts: Partial<SplitOptions> = {},
): Segment[] {
  const cfg: SplitOptions = { ...DEFAULT_SPLIT, ...opts };
  const { w, h, data } = bin;
  if (w <= 0 || h <= 0) return [];

  // 1) 列投影
  const col = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < h; y++) {
      sum += data[y * w + x] > 0 ? 1 : 0;
    }
    col[x] = sum;
  }

  // 2) 找空白间隔段（col <= allowHolePx 视为空）
  const segs: Segment[] = [];
  let x = 0;
  // 跳过开头的空白
  while (x < w && col[x] <= cfg.allowHolePx) x++;
  let start = x;
  while (x < w) {
    if (col[x] <= cfg.allowHolePx) {
      let s = x;
      while (x < w && col[x] <= cfg.allowHolePx) x++;
      const gapW = x - s;
      void gapW;
      if (x - start > 0) segs.push({ x: start, w: x - start });
      start = x;
    } else {
      x++;
    }
  }
  if (start < w) segs.push({ x: start, w: w - start });

  // 3) 过宽段贪心切分
  const maxW = Math.max(1, Math.floor(maxCharW));
  const final: Segment[] = [];
  for (const s of segs) {
    if (s.w <= maxW + 2.5) {
      final.push(s);
      continue;
    }
    const n = Math.max(1, Math.round(s.w / (maxW + 1)));
    const each = s.w / n;
    for (let i = 0; i < n; i++) {
      const sx = Math.floor(s.x + i * each);
      const sw = Math.min(Math.round(each), w - sx);
      if (sw > 0) final.push({ x: sx, w: sw });
    }
  }

  // 4) 过滤过窄 / 全空段
  const out: Segment[] = [];
  for (const s of final) {
    if (s.w < cfg.minSegW) continue;
    let nonEmpty = false;
    for (let dx = 0; dx < s.w && !nonEmpty; dx++) {
      if (col[s.x + dx] > 0) nonEmpty = true;
    }
    if (nonEmpty) out.push(s);
  }

  return out;
}
