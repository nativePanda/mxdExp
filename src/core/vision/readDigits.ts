/**
 * 数字（模板匹配）识别 —— ★ 拒识是可信度的底线。
 *
 * 算法（预研 §9.4 / `probe/exp2d_digits.js`）：
 * 1. 裁剪 ROI → 灰度 → 二值化（前景 = 1）；
 * 2. 列投影分割字形（允许 1~2px 空洞）；
 * 3. 每字形裁紧致包围盒 → 缩放填充到 CANON 画布；
 * 4. 与字形库做 NCC（归一化互相关），取最高分；
 * 5. **置信度 < `nccMin` 或 top1−top2 < `nccMargin` → 返回 `null`（拒识）**。
 *
 * 硬约定（架构 §5.4）：识别失败**一律返回 `null`，绝不返回猜测值或 0**。
 *
 * 宽容档：本函数**不自行切换**宽容阈值；调用方在「连续 N 帧拒识」后，
 * 通过 `opts.nccMin / opts.nccMargin` 传入 `NCC_MIN_TOLERANT / NCC_MARGIN_TOLERANT`
 * （架构 §9.3/§9.4）。
 *
 * 纯函数，零 DOM 依赖。
 */

import type { GlyphScore, PixelSource, ReadDigitsOptions, ReadDigitsResult, RegionRect } from '@/types';
import { ALLOW_CHARS, CANON_H, CANON_W, NCC_MARGIN, NCC_MIN } from '@/constants';
import { binarizeBand } from './binarize';
import { gray } from './color';
import { bboxBinary, cropBox, grayFromBox, type GrayImage } from './normalize';
import { nccRaw } from './ncc';
import { resolveRectPixels } from './profile';
import { splitByProjection } from './segment';
import { TemplateBank } from './templateBank';

/** `readDigits` 的默认参数。 */
const DEFAULT_OPTS: ReadDigitsOptions = {
  nccMin: NCC_MIN,
  nccMargin: NCC_MARGIN,
  allowChars: ALLOW_CHARS,
};

/**
 * 识别区域内的一段数字文字。
 *
 * @param src 像素源（完整帧或已裁剪帧）。
 * @param rect 文字区域（归一化坐标或像素坐标，见 `resolveRectPixels`）。
 * @param bank 字形模板库。
 * @param opts 可选参数（`nccMin` / `nccMargin` / `allowChars`）。
 * @returns `ReadDigitsResult`；**拒识返回 `null`**（绝不返回猜测值）。
 */
export function readDigits(
  src: PixelSource,
  rect: RegionRect,
  bank: TemplateBank,
  opts: Partial<ReadDigitsOptions> = {},
): ReadDigitsResult | null {
  const cfg: ReadDigitsOptions = { ...DEFAULT_OPTS, ...opts };

  if (!src || src.width <= 0 || src.height <= 0) return null;
  if (!bank || bank.size === 0) return null;

  const box = resolveRectPixels(rect, src.width, src.height);

  // 1) ROI → 灰度 → 二值
  const grayAll = grayOfBox(src, box);
  if (!grayAll) return null;

  const bin = binarizeFromGray(grayAll);
  const tight = bboxBinary(bin);
  if (!tight) return null;

  // 2) 列投影分割
  //    容差 `allowHolePx: 1`：真实游戏数字常因抗锯齿/描边残留出现 1px 的"假空洞"，
  //    严格 `col===0` 会把一个字形切成两段（实测 `4` 会被切断）。允许 1 列空档
  //    可在保持"字形间 2px 真间隙"可分割的前提下，避免切开同一字形内部。
  const maxCharW = maxGlyphWidth(bank, cfg.allowChars);
  const segments = splitByProjection(tight, maxCharW, { allowHolePx: 1 });
  if (segments.length === 0) return null;

  // 3) 逐段匹配 + 拒识
  const chars: string[] = [];
  const glyphScores: GlyphScore[][] = [];
  let minScore = Number.POSITIVE_INFINITY;
  let minMargin = Number.POSITIVE_INFINITY;

  for (const seg of segments) {
    const sub = cropBox(tight, { x: seg.x, y: 0, w: seg.w, h: tight.h });
    const subTight = bboxBinary(sub);
    if (!subTight) {
      // 段内无前景 → 拒识整帧（宁可丢一帧，不可算错）。
      return null;
    }

    const ranked = rankGlyphs(subTight, bank, cfg.allowChars);
    if (ranked.length === 0) return null;

    const best = ranked[0];
    const second = ranked[1];

    // 只保留「候选集内」的得分供 UI 展示。
    glyphScores.push(ranked.slice(0, 4));

    if (best.score < cfg.nccMin) return null;
    if (second && best.score - second.score < cfg.nccMargin) return null;

    chars.push(best.ch);
    if (best.score < minScore) minScore = best.score;
    if (second && best.score - second.score < minMargin) minMargin = best.score - second.score;
  }

  if (chars.length === 0) return null;

  const text = chars.join('');
  const value = parseNumber(text);
  if (value === null) return null;

  return {
    value,
    text,
    confidence: Number.isFinite(minScore) ? minScore : 0,
    minMargin: Number.isFinite(minMargin) ? minMargin : 0,
    glyphScores,
  };
}

/**
 * 把数值文本解析为数字（处理千分位 `,` 与百分号 `%`）。
 *
 * 处理规则：
 * - 去掉千分位分隔符 `,`；
 * - 去掉尾随 `%`（百分比数值返回其数值部分，如 `'87%'` → `87`）；
 * - `,` / `%` 之外的字符仅为 `0-9` 与 `.`，否则返回 `null`（拒识）。
 *
 * @param text 识别文本。
 * @returns 数值；无法解析时返回 `null`。
 */
export function parseNumber(text: string): number | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  if (text.includes('?')) return null;
  if (text.includes('/')) return null; // HP 样式 `12/34` 需调用方单独处理，这里拒识

  let s = text.replace(/,/g, '');
  if (s.endsWith('%')) s = s.slice(0, -1);
  if (s.length === 0) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;

  const v = Number(s);
  if (!Number.isFinite(v) || v < 0) return null;
  return v;
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/**
 * 按像素框从 `PixelSource` 取灰度子图。
 *
 * @param src 像素源。
 * @param box 像素框。
 * @returns 灰度图；空框返回 `null`。
 */
function grayOfBox(
  src: PixelSource,
  box: { x: number; y: number; w: number; h: number },
): GrayImage | null {
  if (box.w <= 0 || box.h <= 0) return null;

  // 整帧灰度（本帧只需一次），再裁剪。灰度公式复用 `color.ts`（单一来源）。
  const n = src.width * src.height;
  const grayAll = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = i << 2;
    grayAll[i] = gray(src.data[j], src.data[j + 1], src.data[j + 2]);
  }
  return grayFromBox(grayAll, src.width, box);
}

/**
 * 由灰度图二值化。
 *
 * ⚠️ 必须与 `templateBank.ts` 的模板字形使用**同一套二值化**（`binarizeBand`），
 * 否则模板与待识别字形形态系统性不一致，NCC 会异常偏低甚至拒识。
 *
 * @param gray 灰度图。
 * @returns 二值图。
 */
function binarizeFromGray(gray: GrayImage) {
  return binarizeBand(gray.data, gray.w, gray.h);
}

/**
 * 计算模板库中（在 `allowChars` 内）的最大字形宽度，用于过宽段贪心切分。
 *
 * @param bank 模板库。
 * @param allowChars 允许字符集。
 * @returns 最大宽度；无可用字形时返回 `CANON_W`。
 */
function maxGlyphWidth(bank: TemplateBank, allowChars: string): number {
  const allowed = new Set(allowChars.split(''));
  let mx = 0;
  for (const g of bank.values()) {
    if (allowed.size > 0 && !allowed.has(g.ch)) continue;
    if (g.w > mx) mx = g.w;
  }
  return mx > 0 ? mx : CANON_W;
}

/**
 * 对一个字形子图与模板库内全部候选做 NCC 排序。
 *
 * 说明：为吸收宽高比差异，得分 = `NCC × 宽高比惩罚`（预研 `exp2d_digits.js` 的 `arPen`）。
 *
 * @param sub 字形子图（二值，前景 = 1）。
 * @param bank 模板库。
 * @param allowChars 允许字符集。
 * @returns 按得分降序的候选列表。
 */
function rankGlyphs(sub: GrayImage, bank: TemplateBank, allowChars: string): GlyphScore[] {
  const allowed = new Set(allowChars.split(''));
  const subAr = sub.h > 0 ? sub.w / sub.h : 1;

  const ranked: GlyphScore[] = [];
  for (const g of bank.values()) {
    if (allowed.size > 0 && !allowed.has(g.ch)) continue;
    if (!g.data || g.data.length === 0) continue;

    // 模板字形存的是 CANON 画布（canonW × canonH）上的二值图。
    const score = nccRaw(
      sub.data,
      sub.w,
      sub.h,
      g.data,
      bank.canonW,
      bank.canonH,
      CANON_W,
      CANON_H,
    );

    const tAr = g.h > 0 ? g.w / g.h : 1;
    const arPen = Math.min(1, Math.min(subAr, tAr) / Math.max(subAr, tAr));

    ranked.push({ ch: g.ch, score: score * arPen });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}
