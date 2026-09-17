/**
 * `src/core/vision/` 统一出口。
 *
 * 识别内核（像素分析）：纯函数、零 DOM、零 Vue 依赖，可在 Node 下直接单测。
 */

export { fillness, gray, pixelAt, fillnessAt, grayAt } from './color';
export { otsu, otsuInRange } from './otsu';
export { columnProfile, quantile, resolveRectPixels } from './profile';
export { ratioFromProfiles, median } from './ratio';
export {
  toGray,
  binarize,
  binarizeGray,
  binarizeBand,
  binarizeThreshold,
  type BinaryImage,
} from './binarize';
export { splitByProjection, type Segment, type SplitOptions } from './segment';
export {
  tightBBox,
  cropBox,
  crop,
  to01,
  bboxBinary,
  drawToCanvas,
  grayFromBox,
  type GrayImage,
} from './normalize';
export { corr, ncc, nccRaw } from './ncc';
export { TemplateBank, glyphFromGray, type GlyphRenderer } from './templateBank';
export { readDigits, parseNumber } from './readDigits';
export {
  buildDefaultBank,
  createCanvasGlyphRenderer,
  DEFAULT_GLYPH_CHARS,
  type BuildDefaultBankOptions,
  type CanvasFactory,
  type CanvasRendererOptions,
  type MinimalCanvas,
  type MinimalCanvas2D,
} from './glyphSource';
