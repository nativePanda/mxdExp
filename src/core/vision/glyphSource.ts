/**
 * 默认字形模板生成 —— **可注入渲染器**设计（架构 §9.1 + §2.5 的 Canvas 例外处理）。
 *
 * ## 为什么这样设计
 *
 * 架构硬约定 §5 要求 `core/` 为纯 TS、零 DOM 依赖、不访问 `window`/`document`/`canvas`。
 * 但 `buildDefaultBank()` **必须**用 Canvas `fillText` 渲染字体字形。二者冲突的解法是
 * **依赖倒置**：
 *
 * - **本文件（`core` 内）**：`buildDefaultBank(renderer, opts)` 只接收
 *   「把字符渲染成 `GrayImage` 的函数」（`GlyphRenderer`）这一抽象，**不碰 Canvas**。
 *   这样 `core` 保持零 DOM，`buildDefaultBank` 在 Node 下用位图渲染器即可单测。
 * - **浏览器侧适配器**：`createCanvasGlyphRenderer()` —— 它**同样不访问全局 `window`**，
 *   而是由调用方注入一个 `CanvasFactory`（真实环境传 `() => document.createElement('canvas')`，
 *   或 `() => new OffscreenCanvas(...)`）。这样本文件在静态分析层面依然不引用 DOM 全局，
 *   真正的 DOM 访问发生在浏览器侧调用点。
 *
 * `tests/fixtures/glyphAtlas.ts` 提供纯位图的 `createAtlasGlyphRenderer()`，
 * 让单测无需 DOM 即可构建字形库。
 */

import type { GrayImage } from './normalize';
import { CANON_H, CANON_W } from '@/constants';
import { gray } from './color';
import { TemplateBank, type GlyphRenderer } from './templateBank';

/** 默认可识别字符集（数字 + `%` `,` `.` `/`）。 */
export const DEFAULT_GLYPH_CHARS = '0123456789%,./';

/** `buildDefaultBank` 的可选参数（架构 §9.1）。 */
export interface BuildDefaultBankOptions {
  /** 渲染管线标识（写入 `TemplateBank.scaleKey`）。默认由渲染器自身决定。 */
  scaleKey?: string;
  /** CANON 画布宽，默认 `CANON_W`。 */
  canonW?: number;
  /** CANON 画布高，默认 `CANON_H`。 */
  canonH?: number;
  /** 字符集，默认 `DEFAULT_GLYPH_CHARS`。 */
  chars?: string;
}

/**
 * 由**可注入的渲染器**构建默认字形模板库。
 *
 * 本函数是 `core/` 的一部分，**零 DOM 依赖**：它只调用传入的 `renderer`。
 *
 * @param renderer 渲染器（把字符 → 灰度图）。
 * @param opts 可选参数（`scaleKey` / `canonW` / `canonH` / `chars`）。
 * @returns 构建好的 `TemplateBank`。
 */
export function buildDefaultBank(
  renderer: GlyphRenderer,
  opts: BuildDefaultBankOptions = {},
): TemplateBank {
  const chars = opts.chars ?? DEFAULT_GLYPH_CHARS;
  const bank = new TemplateBank(
    opts.scaleKey ?? 'default',
    opts.canonW ?? CANON_W,
    opts.canonH ?? CANON_H,
  );
  bank.buildFromSource(chars, renderer);
  return bank;
}

// ---------------------------------------------------------------------------
// 浏览器侧 Canvas 渲染适配器（本函数**不引用 DOM 全局**，通过工厂注入）
// ---------------------------------------------------------------------------

/**
 * 最小 2D 绘图上下文接口（只声明我们用到的方法，避免依赖 `lib.dom` 的具体命名）。
 */
export interface MinimalCanvas2D {
  /** 设置字体（如 `'bold 28px Arial'`）。 */
  font: string;
  /** 文本基线。 */
  textBaseline: string;
  /** 文本对齐。 */
  textAlign: string;
  /** 线宽（描边用）。 */
  lineWidth: number;
  /** 描边颜色（与 DOM `CanvasRenderingContext2D.strokeStyle` 一致，允许渐变/图案）。 */
  strokeStyle: string | CanvasGradient | CanvasPattern;
  /** 填充颜色（与 DOM `CanvasRenderingContext2D.fillStyle` 一致，允许渐变/图案）。 */
  fillStyle: string | CanvasGradient | CanvasPattern;
  /** 清空矩形。 */
  clearRect(x: number, y: number, w: number, h: number): void;
  /** 测量文本宽度。 */
  measureText(text: string): { width: number };
  /** 描边文本。 */
  strokeText(text: string, x: number, y: number): void;
  /** 填充文本。 */
  fillText(text: string, x: number, y: number): void;
  /**
   * 把图像绘制到画布。
   *
   * 与 DOM `CanvasRenderingContext2D.drawImage` 保持一致的 **3 参 / 5 参 / 9 参**重载，
   * 以便调用方（`useFrameGrabber.grabRect` 使用 9 参裁剪重载）获得真实的参数类型检查。
   *
   * - 3 参：`drawImage(image, dx, dy)`
   * - 5 参：`drawImage(image, dx, dy, dWidth, dHeight)`
   * - 9 参：`drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)`
   *
   * @param image 源图像。
   * @param dx 目标 x 或源矩形 x（随重载而定）。
   * @param dy 目标 y 或源矩形 y（随重载而定）。
   * @param dw 目标宽 / 源宽 / 源矩形 x（随重载而定）。
   * @param dh 目标高 / 源高 / 源矩形 y（随重载而定）。
   * @param dx2 目标 x / 源矩形宽 / 目标宽（随重载而定）。
   * @param dy2 目标 y / 源矩形高 / 目标高（随重载而定）。
   * @param dw2 目标宽 / 目标高（随重载而定）。
   * @param dh2 目标高（随重载而定）。
   */
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  /** 取像素数据。 */
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}

/** 最小 Canvas 接口（只声明用到的方法）。 */
export interface MinimalCanvas {
  /** 画布宽。 */
  width: number;
  /** 画布高。 */
  height: number;
  /** 取 2D 上下文。 */
  getContext(id: '2d'): MinimalCanvas2D | null;
}

/**
 * Canvas 工厂：由**调用方**注入，用于创建画布（浏览器侧用 `document.createElement`
 * 或 `new OffscreenCanvas`）。把这一步外置，`core/` 本身就不引用 DOM 全局。
 */
export type CanvasFactory = (w: number, h: number) => MinimalCanvas;

/** `createCanvasGlyphRenderer` 的可选参数。 */
export interface CanvasRendererOptions {
  /** 字体族，默认 `'Arial, "Helvetica Neue", "Segoe UI", sans-serif'`。 */
  fontFamily?: string;
  /** 字号（px），默认 28。 */
  fontSize?: number;
  /** 是否加粗，默认 `true`。 */
  bold?: boolean;
  /** 描边宽度（模拟游戏白字黑边），默认 2。 */
  outline?: number;
  /** 放大倍数（先放大渲染再取像素，等价预研的 scale=3），默认 3。 */
  scale?: number;
  /** 前景色（字色），默认白色 `[255,255,255]`。 */
  fgColor?: [number, number, number];
  /** 描边色，默认黑色 `[0,0,0]`。 */
  outlineColor?: [number, number, number];
}

/**
 * 创建 **Canvas `fillText` 渲染器**（浏览器侧适配器）。
 *
 * ⚠️ 本函数**本身不访问 `window`/`document`**：画布由调用方通过 `factory` 注入。
 * 因此本文件在静态层面仍是纯净的（不引用 DOM 全局标识符），符合架构 §5.8
 * 「纯函数不得依赖 window」的精神。
 *
 * 用法（浏览器侧调用点）：
 * ```ts
 * import { buildDefaultBank, createCanvasGlyphRenderer } from '@/core/vision';
 * const renderer = createCanvasGlyphRenderer((w, h) => {
 *   const c = document.createElement('canvas');   // ← DOM 访问发生在调用点，而非 core
 *   c.width = w; c.height = h; return c;
 * });
 * const bank = buildDefaultBank(renderer, { scaleKey: 'canvas-28-bold2' });
 * ```
 *
 * @param factory 画布工厂。
 * @param opts 可选参数（字体/字号/描边/放大倍数/颜色）。
 * @returns `GlyphRenderer`。
 */
export function createCanvasGlyphRenderer(
  factory: CanvasFactory,
  opts: CanvasRendererOptions = {},
): GlyphRenderer {
  const fontFamily = opts.fontFamily ?? 'Arial, "Helvetica Neue", "Segoe UI", sans-serif';
  const fontSize = opts.fontSize ?? 28;
  const bold = opts.bold ?? true;
  const outline = opts.outline ?? 2;
  const scale = Math.max(1, opts.scale ?? 3);
  const fg = opts.fgColor ?? [255, 255, 255];
  const oc = opts.outlineColor ?? [0, 0, 0];

  const pad = Math.ceil(outline + 4);
  const cellW = Math.ceil(fontSize * 1.6) + pad * 2;
  const cellH = Math.ceil(fontSize * 1.6) + pad * 2;
  const cw = cellW * scale;
  const chh = cellH * scale;

  return (ch: string): GrayImage | null => {
    if (ch.length !== 1) return null;
    const canvas = factory(cw, chh);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.clearRect(0, 0, cw, chh);
    ctx.font = `${bold ? 'bold ' : ''}${fontSize * scale}px ${fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const cx = cw / 2;
    const cy = chh / 2;

    if (outline > 0) {
      ctx.lineWidth = outline * scale;
      ctx.strokeStyle = `rgb(${oc[0]},${oc[1]},${oc[2]})`;
      ctx.strokeText(ch, cx, cy);
    }
    ctx.fillStyle = `rgb(${fg[0]},${fg[1]},${fg[2]})`;
    ctx.fillText(ch, cx, cy);

    const img = ctx.getImageData(0, 0, cw, chh);
    return rgbaToGrayImage(img.data, cw, chh);
  };
}

/**
 * RGBA 像素 → 灰度图（用于 Canvas 渲染产物）。
 *
 * 灰度公式**复用 `color.ts` 的 `gray()`**（架构 §5.5 要求单一来源），
 * 因此本函数只是把 Canvas 的 RGBA 逐像素喂给 `gray()` 打包成 `GrayImage`。
 *
 * @param rgba RGBA 数据。
 * @param w 宽度。
 * @param h 高度。
 * @returns 灰度图。
 */
function rgbaToGrayImage(rgba: Uint8ClampedArray, w: number, h: number): GrayImage {
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const j = i << 2;
    out[i] = gray(rgba[j], rgba[j + 1], rgba[j + 2]);
  }
  return { w, h, data: out };
}
