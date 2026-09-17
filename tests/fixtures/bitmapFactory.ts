/**
 * 测试夹具：程序化生成模拟位图（用 `pngjs`）。
 *
 * ⚠️ 依据架构 §8.2 / prompt：模拟位图**只作为单元测试夹具**，不进 `src/`、不进最终产物。
 *
 * 生成算法**移植自预研脚本**：
 * - 经验条：`probe/exp1c_expbar.js` 的 `makeExpBar` +
 *   `probe/exp5c_temporal.js` 的 `gen`（含高光扫过）；
 * - 数字文字：`probe/exp2d_digits.js` 的 `renderString` + `addNoise`。
 *
 * 所有函数返回 `PixelSource`（`{width, height, data: Uint8ClampedArray}`），
 * 可直接喂给 `core/vision` 的纯函数。
 */

import type { PixelSource } from '@/types';

/** 一张模拟位图（与 `PixelSource` 结构一致）。 */
export type FixtureImage = PixelSource;

/** `makeExpBar` 的可选参数（同预研 `makeExpBar`）。 */
export interface ExpBarOptions {
  /** 边框宽度，默认 1。 */
  border?: number;
  /** 底色（深棕），默认 `[45,34,22]`。 */
  bgColor?: [number, number, number];
  /** 填充渐变色（起），默认 `[255,160,40]`。 */
  fillStart?: [number, number, number];
  /** 填充渐变色（终），默认 `[255,230,90]`。 */
  fillEnd?: [number, number, number];
  /** 边框色，默认 `[120,95,55]`。 */
  borderColor?: [number, number, number];
  /** 噪声幅度（每通道 ±amp），默认 0。 */
  noiseAmp?: number;
  /** 噪声种子，默认 12345。 */
  noiseSeed?: number;
  /** 是否加高光，默认 false。 */
  highlight?: boolean;
  /** 高光位置（0–1，相对条宽），默认 0.5。 */
  highlightX?: number;
  /** 高光半宽（px），默认 3。 */
  highlightW?: number;
}

/**
 * 生成一条模拟经验条。
 *
 * @param w 宽（px）。
 * @param h 高（px）。
 * @param ratio 填充比例（0–1）。
 * @param opts 可选参数。
 * @returns 模拟位图。
 */
export function makeExpBar(w: number, h: number, ratio: number, opts: ExpBarOptions = {}): FixtureImage {
  const border = opts.border ?? 1;
  const bgColor = opts.bgColor ?? [45, 34, 22];
  const fillStart = opts.fillStart ?? [255, 160, 40];
  const fillEnd = opts.fillEnd ?? [255, 230, 90];
  const borderColor = opts.borderColor ?? [120, 95, 55];
  const noiseAmp = opts.noiseAmp ?? 0;
  const noiseSeed = opts.noiseSeed ?? 12345;
  const highlight = opts.highlight ?? false;
  const highlightX = opts.highlightX ?? 0.5;
  const highlightW = opts.highlightW ?? 3;

  const data = new Uint8ClampedArray(w * h * 4);
  let seed = noiseSeed >>> 0;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  const innerW = w - border * 2;
  const fillPx = Math.round(innerW * ratio);
  const hx = Math.round(w * highlightX);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (w * y + x) << 2;
      let r: number;
      let g: number;
      let b: number;

      const onBorder = x < border || x >= w - border || y < border || y >= h - border;
      if (onBorder) {
        [r, g, b] = borderColor;
      } else {
        const ix = x - border;
        if (ix < fillPx) {
          const t = innerW > 1 ? ix / (innerW - 1) : 0;
          r = Math.round(fillStart[0] + (fillEnd[0] - fillStart[0]) * t);
          g = Math.round(fillStart[1] + (fillEnd[1] - fillStart[1]) * t);
          b = Math.round(fillStart[2] + (fillEnd[2] - fillStart[2]) * t);
        } else {
          [r, g, b] = bgColor;
        }
      }

      if (noiseAmp > 0) {
        r = clamp255(r + (rnd() * 2 - 1) * noiseAmp);
        g = clamp255(g + (rnd() * 2 - 1) * noiseAmp);
        b = clamp255(b + (rnd() * 2 - 1) * noiseAmp);
      }

      if (highlight && Math.abs(x - hx) <= highlightW) {
        r = 255;
        g = 255;
        b = 245;
      }

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  return { width: w, height: h, data };
}

/**
 * 生成一帧带高光的经验条（高光位置由帧序号决定）。
 *
 * 用于「高光扫过」场景：高光竖直亮带从条左扫到条右。
 *
 * @param w 宽（px）。
 * @param h 高（px）。
 * @param ratio 填充比例。
 * @param frameIndex 帧序号。
 * @param framesPerCycle 一个扫过周期的帧数，默认 12。
 * @returns 模拟位图。
 */
export function makeHighlightFrame(
  w: number,
  h: number,
  ratio: number,
  frameIndex: number,
  framesPerCycle = 12,
): FixtureImage {
  const hlFrac = (frameIndex % framesPerCycle) / framesPerCycle;
  return makeExpBar(w, h, ratio, { highlight: true, highlightX: hlFrac });
}

// ---------------------------------------------------------------------------
// 数字文字夹具（移植 exp2d_digits.js）
// ---------------------------------------------------------------------------

/** 5×7 位图字形表（预研 `exp2d_digits.js` 的 `GLYPHS`）。 */
export const GLYPH_PATTERNS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '%': ['11001', '11010', '00100', '01000', '10110', '00110', '00000'],
  ',': ['00000', '00000', '00000', '00000', '00100', '00100', '01000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
};

/** 字形位图宽（列数）。 */
export const GLYPH_W = 5;
/** 字形位图高（行数）。 */
export const GLYPH_H = 7;

/** 灰度小图（内部用）。 */
interface MiniGray {
  w: number;
  h: number;
  data: Float64Array;
}

/**
 * 渲染单个字形（放大 `scale` 倍，可选描边）。
 *
 * @param ch 字符。
 * @param scale 放大倍数。
 * @param outline 是否描边。
 * @returns 灰度小图；未知字符返回 `null`。
 */
export function renderGlyph(ch: string, scale: number, outline: boolean): MiniGray | null {
  const pat = GLYPH_PATTERNS[ch];
  if (!pat) return null;
  const pad = outline ? 1 : 0;
  const w = (GLYPH_W + pad * 2) * scale;
  const h = (GLYPH_H + pad * 2) * scale;
  const m = new Float64Array(w * h);

  for (let y = 0; y < GLYPH_H; y++) {
    for (let x = 0; x < GLYPH_W; x++) {
      if (pat[y][x] !== '1') continue;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          m[((y + pad) * scale + sy) * w + ((x + pad) * scale + sx)] = 255;
        }
      }
    }
  }

  if (outline) {
    const out = m.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (m[y * w + x] === 255) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy >= 0 && xx >= 0 && yy < h && xx < w && m[yy * w + xx] === 255) {
              near = true;
              break;
            }
          }
        }
        if (near) out[y * w + x] = 80;
      }
    }
    return { w, h, data: out };
  }

  return { w, h, data: m };
}

/**
 * 渲染一串字符为灰度小图（字形间加 `gapPx` 空白列）。
 *
 * @param str 字符串。
 * @param scale 放大倍数。
 * @param outline 是否描边。
 * @param gapPx 字形间空白列数，默认 `max(1, round(scale/2))`。
 * @returns 灰度小图。
 */
export function renderStringGray(
  str: string,
  scale: number,
  outline: boolean,
  gapPx?: number,
): MiniGray {
  const gap = gapPx ?? Math.max(1, Math.round(scale / 2));
  const parts: MiniGray[] = [];
  for (const ch of str) {
    const g = renderGlyph(ch, scale, outline);
    if (g) parts.push(g);
  }
  if (parts.length === 0) return { w: 1, h: 1, data: new Float64Array(1) };

  const H = parts[0].h;
  const W = parts.reduce((a, p) => a + p.w, 0) + gap * (parts.length - 1);
  const data = new Float64Array(W * H);
  let ox = 0;
  for (const p of parts) {
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        data[y * W + ox + x] = p.data[y * p.w + x];
      }
    }
    ox += p.w + gap;
  }
  return { w: W, h: H, data };
}

/**
 * 渲染一串字符为 `PixelSource`（灰度→RGBA）。
 *
 * @param str 字符串。
 * @param scale 放大倍数。
 * @param outline 是否描边。
 * @param gapPx 字形间空白列数。
 * @returns 模拟位图。
 */
export function renderString(
  str: string,
  scale: number,
  outline: boolean,
  gapPx?: number,
): FixtureImage {
  const g = renderStringGray(str, scale, outline, gapPx);
  return grayToPixelSource(g);
}

/**
 * 给 `PixelSource` 添加均匀随机噪声（每通道 ±amp）。
 *
 * 移植 `exp2d_digits.js` 的 `addNoise`（线性同余伪随机，可复现）。
 *
 * @param img 输入位图（**就地修改**并返回）。
 * @param amp 噪声幅度。
 * @param seed0 随机种子。
 * @returns 修改后的位图。
 */
export function addNoise(img: FixtureImage, amp: number, seed0: number): FixtureImage {
  let s = (seed0 >>> 0) || 1;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  for (let i = 0; i < img.data.length; i++) {
    img.data[i] = clamp255(img.data[i] + (rnd() * 2 - 1) * amp);
  }
  return img;
}

/**
 * 在画布上水平平移图像（用于平移鲁棒性测试）。
 *
 * @param img 输入位图。
 * @param shiftPx 平移量（正数右移）。
 * @param padPx 两侧留白，默认 `abs(shiftPx) + 2`。
 * @returns 平移后的新位图。
 */
export function shiftImage(img: FixtureImage, shiftPx: number, padPx?: number): FixtureImage {
  const pad = padPx ?? Math.abs(shiftPx) + 2;
  const w = img.width + pad * 2;
  const h = img.height;
  const data = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < img.width; x++) {
      const sx = x + pad + shiftPx;
      if (sx < 0 || sx >= w) continue;
      const si = (img.width * y + x) << 2;
      const di = (w * y + sx) << 2;
      data[di] = img.data[si];
      data[di + 1] = img.data[si + 1];
      data[di + 2] = img.data[si + 2];
      data[di + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/**
 * 灰度小图 → `PixelSource`（灰度写入 R/G/B，A=255）。
 *
 * @param g 灰度小图。
 * @returns 模拟位图。
 */
export function grayToPixelSource(g: MiniGray): FixtureImage {
  const data = new Uint8ClampedArray(g.w * g.h * 4);
  for (let i = 0; i < g.w * g.h; i++) {
    const v = clamp255(g.data[i]);
    const j = i << 2;
    data[j] = v;
    data[j + 1] = v;
    data[j + 2] = v;
    data[j + 3] = 255;
  }
  return { width: g.w, height: g.h, data };
}

/**
 * 数值裁剪到 [0,255] 并取整。
 *
 * @param v 输入值。
 * @returns 裁剪后的整数。
 */
function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
