/**
 * 经验条填充比例识别 —— **跨帧 2D 中值 + Otsu + 边界扫描**（★ 最关键）。
 *
 * 算法（预研 §9.3 / `probe/exp5c_temporal.js`）：
 * 1. 对每一列 `dx`，收集最近 N 帧该列的值，**取中值** → 一条"干净"的列剖面。
 *    - 这是**抗高光的唯一有效解法**：帧级中值/均值对"高光扫过"完全无效
 *      （因为多数帧被污染），只有"逐列跨帧"中值才能恢复出干净剖面（实测误差 0.0px）。
 * 2. `FULL_EMPTY_DELTA` 判定：`` max - min < delta `` 时 Otsu 退化（无底色对照），
 *    直接依据绝对值判**全满**或**全空**。
 * 3. 否则 `Otsu(clean)` 求自适应阈值 → 从左扫描找填充边界（允许 `MAX_BAR_HOLES_RATIO`
 *    的空洞容差）。
 *
 * 纯函数，零 DOM 依赖。
 */

import type { ExpBarProfile, RatioOptions, RatioResult } from '@/types';
import {
  FRAME_N,
  FULL_EMPTY_DELTA,
  MAX_BAR_HOLES_RATIO,
} from '@/constants';
import { otsu } from './otsu';

/** `ratioFromProfiles` 的默认参数。 */
const DEFAULT_OPTS: RatioOptions = {
  frameCount: FRAME_N,
  maxHolesRatio: MAX_BAR_HOLES_RATIO,
  fullEmptyDelta: FULL_EMPTY_DELTA,
};

/**
 * 「全满 / 全空」的绝对判别：fillness 高于此值视为填充色，低于此值视为底色。
 *
 * 依据：经验条橙黄填充 fillness ≈ 255 − 1.2*40 + 0.2*160 ≈ 239；深棕底
 * fillness ≈ 45 − 1.2*22 + 0.2*34 ≈ 25。取中点 130 作为分界。
 */
const FULL_LEVEL_THRESHOLD = 130;

/** 「全空」时填充度上限（含噪声余量）。 */
const EMPTY_LEVEL_THRESHOLD = 60;

/**
 * 跨帧 2D 中值 + Otsu + 边界扫描，得到经验条填充比例。
 *
 * @param frames 最近 N 帧的列剖面（**按时间升序**，最后一项为最新帧）。
 *   调用方负责维护环形缓冲；本函数只取**最后 `opts.frameCount` 帧**。
 * @param opts 可选参数（`frameCount` / `maxHolesRatio` / `fullEmptyDelta`）。
 * @returns `RatioResult`；无法判定时 `confidence = 0`，调用方应忽略该帧。
 */
export function ratioFromProfiles(
  frames: ExpBarProfile[],
  opts: Partial<RatioOptions> = {},
): RatioResult {
  const cfg: RatioOptions = { ...DEFAULT_OPTS, ...opts };

  if (!Array.isArray(frames) || frames.length === 0) {
    return { ratio: 0, isFull: false, isEmpty: false, confidence: 0 };
  }

  const frameCount = Math.max(1, Math.floor(cfg.frameCount));
  const recent = frames.slice(-frameCount).filter((f) => f && f.width > 0);
  if (recent.length === 0) {
    return { ratio: 0, isFull: false, isEmpty: false, confidence: 0 };
  }

  // 列数：以第一帧为准，逐列只取列数一致的帧（防不同帧宽度不一致时污染）。
  const w = recent[0].width;
  const usable = recent.filter((f) => f.width === w);
  if (w <= 0 || usable.length === 0) {
    return { ratio: 0, isFull: false, isEmpty: false, confidence: 0 };
  }

  // ---- 步骤 1：逐列跨帧中值（抗高光的关键） ----
  const clean = new Float64Array(w);
  const colBuf = new Float64Array(usable.length);
  for (let dx = 0; dx < w; dx++) {
    for (let f = 0; f < usable.length; f++) {
      colBuf[f] = usable[f].columns[dx];
    }
    clean[dx] = median(colBuf, usable.length);
  }

  // ---- 步骤 2：全满 / 全空判别（避免 Otsu 退化） ----
  let mn = Number.POSITIVE_INFINITY;
  let mx = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < w; i++) {
    const v = clean[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }

  // 帧数太少时（不足 2 帧）中值退化为单帧，置信度打折但仍可给出结果。
  const sampleConfidence = Math.min(1, usable.length / Math.min(frameCount, 3));

  // 判别一（优先，抗填充渐变）：整条最低值仍在"填充色"量级 → 全满。
  // 经验条填充色（橙黄）fillness 约 190~240，底色（深棕）约 25；
  // 因此"最小列都 > FULL_LEVEL_THRESHOLD"即整条皆填充 → 全满。
  if (mn >= FULL_LEVEL_THRESHOLD) {
    return { ratio: 1, isFull: true, isEmpty: false, confidence: 1 };
  }
  // 判别二：整条最高值仍在"底色"量级 → 全空。
  if (mx <= EMPTY_LEVEL_THRESHOLD) {
    return { ratio: 0, isFull: false, isEmpty: true, confidence: 1 };
  }

  // 判别三（兜底）：动态范围过小且落在中间地带 → 无法判定。
  if (mx - mn < cfg.fullEmptyDelta) {
    return { ratio: 0, isFull: false, isEmpty: false, confidence: 0 };
  }

  // ---- 步骤 3：Otsu + 边界扫描 ----
  const thr = otsu(clean);

  // 若整条都高于阈值 → 全满（Otsu 在 100% 时无对照，这里兜住）。
  let allAbove = true;
  for (let i = 0; i < w; i++) {
    if (clean[i] < thr) {
      allAbove = false;
      break;
    }
  }
  if (allAbove) {
    return { ratio: 1, isFull: true, isEmpty: false, confidence: 1 };
  }

  const maxHoles = Math.max(2, Math.round(w * cfg.maxHolesRatio));
  let boundary = 0;
  let holes = 0;
  for (let i = 0; i < w; i++) {
    if (clean[i] >= thr) {
      boundary = i + 1;
      holes = 0;
    } else {
      holes += 1;
      if (holes > maxHoles) break;
    }
  }

  const ratio = boundary / w;

  // 置信度：边界扫描后仍存在空洞（说明剖面不干净）时适度打折。
  const tailHoles = holes > 0 ? 1 - Math.min(1, holes / Math.max(1, maxHoles)) : 1;
  const confidence = clamp01(sampleConfidence * (0.5 + 0.5 * tailHoles));

  return {
    ratio: clamp01(ratio),
    isFull: ratio >= 1,
    isEmpty: ratio <= 0,
    confidence,
  };
}

/**
 * 取数组前 `len` 个元素的中值（在副本上排序）。
 *
 * 说明：帧数为偶数时取**较小者**索引 `(len-1)>>1`，与预研脚本
 * `exp5c_temporal.js` 的 `vals[(vals.length-1)>>1]` 保持一致。
 *
 * @param values 数值数组（长度 ≥ len）。
 * @param len 有效长度。
 * @returns 中值；`len <= 0` 返回 0。
 */
export function median(values: Float64Array, len: number): number {
  if (len <= 0) return 0;
  const copy = values.slice(0, len);
  copy.sort();
  return copy[(len - 1) >> 1];
}

/**
 * 把数值裁剪到 [0,1]。
 *
 * @param v 输入值。
 * @returns 裁剪后的值。
 */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
