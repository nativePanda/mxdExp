/**
 * 测试夹具：**纯位图字形渲染器**（Node 环境，无需 DOM）。
 *
 * 提供 `createAtlasGlyphRenderer()`，把 `bitmapFactory` 的 5×7 位图字形
 * （放大 `scale` 倍、可选描边）渲染成 `GrayImage`，供 `buildDefaultBank` 构建模板库。
 *
 * 这样 `readDigits` 的单测**完全不依赖 Canvas/DOM**，验证的是「分割 → 归一化 → NCC → 拒识」
 * 这条链路本身（架构 §7 T02-3 要求的 Node 可测性）。
 */

import type { GrayImage } from '@/core/vision';
import type { GlyphRenderer } from '@/core/vision';
import { renderGlyph } from './bitmapFactory';

/** `createAtlasGlyphRenderer` 的可选参数。 */
export interface AtlasRendererOptions {
  /** 放大倍数，默认 3（与预研 exp2d 一致）。 */
  scale?: number;
  /** 是否描边，默认 true（模拟游戏白字黑边）。 */
  outline?: boolean;
}

/**
 * 创建基于 5×7 位图字形的渲染器（纯 Node，无 DOM）。
 *
 * @param opts 可选参数（`scale` / `outline`）。
 * @returns `GlyphRenderer`。
 */
export function createAtlasGlyphRenderer(opts: AtlasRendererOptions = {}): GlyphRenderer {
  const scale = Math.max(1, opts.scale ?? 3);
  const outline = opts.outline ?? true;

  return (ch: string): GrayImage | null => {
    if (ch.length !== 1) return null;
    const g = renderGlyph(ch, scale, outline);
    if (!g) return null;
    return { w: g.w, h: g.h, data: g.data };
  };
}
