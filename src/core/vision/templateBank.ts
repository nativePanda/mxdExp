/**
 * 字形模板库 `TemplateBank` —— 纯函数 + 类，零 DOM 依赖。
 *
 * 职责（架构 §2.5 / §3.1）：
 * - 由「把字符渲染成灰度图」的源构建模板（`buildFromSource`，可注入渲染器）；
 * - `addGlyph` / `get` / 迭代所有字形，供 `readDigits` 做 NCC；
 * - `serialize` / `deserialize`（Float32Array → number[]），便于存 IndexedDB / 内置 JSON。
 *
 * 说明：真正的 **Canvas `fillText` 渲染**放在 `glyphSource.ts` 的浏览器侧适配器里，
 * 本文件只依赖「一个把字符渲染成 `GrayImage` 的函数」这一抽象 —— 因此 `core/`
 * 自身在 Node 下完全可测（架构 §9.1 的可注入渲染器方案）。
 */

import type { Glyph, SerializedTemplateBank } from '@/types';
import { CANON_H, CANON_W } from '@/constants';
import { binarizeBand, type BinaryImage } from './binarize';
import { bboxBinary, drawToCanvas, type GrayImage } from './normalize';

/**
 * 渲染器：把一个字符渲染成灰度图（前景 = 亮字）。
 *
 * 浏览器侧实现用 Canvas `fillText`（见 `glyphSource.ts`）；
 * 测试侧可用位图字形（见 `tests/fixtures/glyphAtlas.ts`）。
 *
 * @param ch 单个字符。
 * @returns 灰度图；无法渲染时返回 `null`。
 */
export type GlyphRenderer = (ch: string) => GrayImage | null;

/**
 * 字形模板库。
 *
 * 每个 `Glyph` 的 `data` 是**归一化到 CANON 画布后的二值图**（0/1），长度 = `canonW * canonH`。
 */
export class TemplateBank {
  /** 渲染管线标识（如 `'canvas-28-bold2'`、`'atlas-s3'`）。 */
  scaleKey: string;

  /** 字符 → 字形。 */
  glyphs: Map<string, Glyph>;

  /** CANON 画布宽。 */
  canonW: number;

  /** CANON 画布高。 */
  canonH: number;

  /**
   * 构造一个空模板库。
   *
   * @param scaleKey 渲染管线标识，默认 `'default'`。
   * @param canonW CANON 画布宽，默认 `CANON_W`。
   * @param canonH CANON 画布高，默认 `CANON_H`。
   */
  constructor(scaleKey = 'default', canonW = CANON_W, canonH = CANON_H) {
    this.scaleKey = scaleKey;
    this.glyphs = new Map<string, Glyph>();
    this.canonW = canonW;
    this.canonH = canonH;
  }

  /**
   * 添加 / 覆盖一个字形。
   *
   * @param ch 字符。
   * @param glyph 字形（`data` 应为 CANON 画布上的归一化二值图）。
   */
  addGlyph(ch: string, glyph: Glyph): void {
    this.glyphs.set(ch, glyph);
  }

  /** 已收录的字符数。 */
  get size(): number {
    return this.glyphs.size;
  }

  /**
   * 取一个字形。
   *
   * @param ch 字符。
   * @returns 字形或 `undefined`。
   */
  get(ch: string): Glyph | undefined {
    return this.glyphs.get(ch);
  }

  /** 是否包含某字符。 */
  has(ch: string): boolean {
    return this.glyphs.has(ch);
  }

  /** 迭代全部字形。 */
  values(): IterableIterator<Glyph> {
    return this.glyphs.values();
  }

  /** 迭代全部字符。 */
  keys(): IterableIterator<string> {
    return this.glyphs.keys();
  }

  /**
   * 由可注入的渲染器构建模板库。
   *
   * 流程（架构 §9.1）：对每个字符 → `renderer(ch)` 得到灰度图 → `to01` 二值化
   * → `bboxBinary` 裁紧致框 → `drawToCanvas` 缩放到 CANON → 存入。
   *
   * @param chars 字符集（如 `'0123456789%,./'`）。
   * @param renderer 渲染器。
   * @returns `this`（链式）。
   */
  buildFromSource(chars: string, renderer: GlyphRenderer): TemplateBank {
    for (const ch of chars) {
      const img = renderer(ch);
      if (!img) continue;
      const glyph = glyphFromGray(img, ch, this.canonW, this.canonH);
      if (glyph) this.glyphs.set(ch, glyph);
    }
    return this;
  }

  /**
   * 从整体截图的若干「字符区域」添加字形（模板采集向导用）。
   *
   * @param entries 字符 → 灰度图（已裁剪到该字符）的列表。
   * @returns `this`（链式）。
   */
  addFromRegions(entries: Array<{ ch: string; img: GrayImage }>): TemplateBank {
    for (const e of entries) {
      const glyph = glyphFromGray(e.img, e.ch, this.canonW, this.canonH);
      if (glyph) this.glyphs.set(e.ch, glyph);
    }
    return this;
  }

  /**
   * 序列化为可存 JSON 的结构。
   *
   * @returns `SerializedTemplateBank`。
   */
  serialize(): SerializedTemplateBank {
    const glyphs: SerializedTemplateBank['glyphs'] = {};
    for (const g of this.glyphs.values()) {
      glyphs[g.ch] = {
        ch: g.ch,
        w: g.w,
        h: g.h,
        data: Array.from(g.data),
      };
    }
    return {
      scaleKey: this.scaleKey,
      canonW: this.canonW,
      canonH: this.canonH,
      glyphs,
    };
  }

  /**
   * 从序列化结构反序列化。
   *
   * @param obj 序列化结构。
   * @returns 新的 `TemplateBank`；结构非法时返回空库。
   */
  static deserialize(obj: SerializedTemplateBank): TemplateBank {
    const canonW = Number.isFinite(obj?.canonW) && obj.canonW > 0 ? obj.canonW : CANON_W;
    const canonH = Number.isFinite(obj?.canonH) && obj.canonH > 0 ? obj.canonH : CANON_H;
    const bank = new TemplateBank(obj?.scaleKey ?? 'default', canonW, canonH);

    const glyphs = obj?.glyphs ?? {};
    for (const key of Object.keys(glyphs)) {
      const raw = glyphs[key];
      if (!raw || !Array.isArray(raw.data)) continue;
      const data = new Float32Array(raw.data.length);
      for (let i = 0; i < raw.data.length; i++) data[i] = raw.data[i];
      bank.addGlyph(raw.ch ?? key, {
        ch: raw.ch ?? key,
        w: raw.w ?? 0,
        h: raw.h ?? 0,
        data,
      });
    }
    return bank;
  }
}

/**
 * 由灰度图构造一个 CANON 画布字形。
 *
 * @param img 灰度图（已裁剪到单个字符）。
 * @param ch 字符。
 * @param canonW CANON 画布宽。
 * @param canonH CANON 画布高。
 * @returns 字形；无前景时返回 `null`。
 */
export function glyphFromGray(
  img: GrayImage,
  ch: string,
  canonW = CANON_W,
  canonH = CANON_H,
): Glyph | null {
  // 灰度 → 二值（前景 = 1）。
  //
  // ⚠️ 关键一致性要求：这里**必须**与 `readDigits` 识别链路使用**同一套二值化**
  // （同为 `binarizeBand`），否则模板字形与待识别字形的二值边界不一致，
  // 归一化后形状出现系统性差异，NCC 会异常偏低（实测 Otsu 下 `0` 会从 1.0 掉到 0.54，
  // 且合成夹具的 `4` 会被 Otsu 丢掉描边、切成两段）。
  const bin: BinaryImage = binarizeBand(img.data, img.w, img.h);
  const tight = bboxBinary(bin);
  if (!tight) return null;

  // 缩放到 CANON 画布
  const canon = drawToCanvas({ w: tight.w, h: tight.h, data: tight.data }, canonW, canonH);

  const data = new Float32Array(canon.data.length);
  for (let i = 0; i < canon.data.length; i++) data[i] = canon.data[i];

  return { ch, w: tight.w, h: tight.h, data };
}
