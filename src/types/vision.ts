/**
 * 识别内核（vision）接口定义。
 *
 * 依据：架构文档 §3.1（类图 + 关键函数签名）。
 *
 * 硬约定（架构文档 §5.4）：
 * - 识别失败一律返回 `null`，**绝不返回猜测值或 0**。
 * - `ratioFromProfiles` 无法判定 → `confidence = 0`，调用方忽略该帧。
 */

import type { RegionRect } from './calibration';

// ---------------------------------------------------------------------------
// 像素源 PixelSource
// ---------------------------------------------------------------------------

/**
 * 像素源：与 `ImageData` 结构兼容的最小接口。
 * 长度为 `width * height * 4` 的 RGBA 数组（Alpha 通道忽略）。
 */
export interface PixelSource {
  /** 宽度（px）。 */
  width: number;
  /** 高度（px）。 */
  height: number;
  /** RGBA 像素数据。 */
  data: Uint8ClampedArray | Uint8Array;
}

// ---------------------------------------------------------------------------
// 包围盒 BBox
// ---------------------------------------------------------------------------

/** 像素整数包围盒。 */
export interface BBox {
  /** 左上角 x（px）。 */
  x: number;
  /** 左上角 y（px）。 */
  y: number;
  /** 宽度（px）。 */
  w: number;
  /** 高度（px）。 */
  h: number;
}

// ---------------------------------------------------------------------------
// 字形 Glyph 与模板库 TemplateBank（架构 §3.1）
// ---------------------------------------------------------------------------

/** 单个字形模板（已归一化到 CANON 画布）。 */
export interface Glyph {
  /** 该字形对应的字符（如 `'0'`、`'%'`）。 */
  ch: string;
  /** 原始字形裁剪宽度（px）。 */
  w: number;
  /** 原始字形裁剪高度（px）。 */
  h: number;
  /** 归一化到 CANON 画布后的二值图数据（长度 = canonW * canonH）。 */
  data: Float32Array;
}

/** 字形模板库序列化后的结构（可存 IndexedDB / 内置 JSON）。 */
export interface SerializedTemplateBank {
  /** 缩放/渲染管线的标识（如 `'s3'`）。 */
  scaleKey: string;
  /** 归一化画布宽。 */
  canonW: number;
  /** 归一化画布高。 */
  canonH: number;
  /** 字符 → 归一化二值图数据（Float32Array 序列化为普通数组）。 */
  glyphs: Record<string, { ch: string; w: number; h: number; data: number[] }>;
}

// ---------------------------------------------------------------------------
// 经验条剖面 ExpBarProfile（架构 §3.1）
// ---------------------------------------------------------------------------

/** 单帧经验条的逐列剖面（已取分位数）。 */
export interface ExpBarProfile {
  /** 逐列的 fillness 值（长度 = width）。 */
  columns: Float64Array;
  /** 列数（= 校准框宽度）。 */
  width: number;
}

// ---------------------------------------------------------------------------
// 比例识别结果 RatioResult（架构 §3.1）
// ---------------------------------------------------------------------------

/** 跨帧 2D 中值后的经验条比例结果。 */
export interface RatioResult {
  /** 填充比例 0–1。 */
  ratio: number;
  /** 是否判定为「满」(100%)。 */
  isFull: boolean;
  /** 是否判定为「空」(0%)。 */
  isEmpty: boolean;
  /** 置信度 0–1；`0` 表示无法判定，调用方应忽略该帧。 */
  confidence: number;
}

/** `ratioFromProfiles` 的可选参数。 */
export interface RatioOptions {
  /** 跨帧 2D 中值窗口（默认 `FRAME_N` = 12）。 */
  frameCount: number;
  /** 边界扫描允许空洞比例（默认 `MAX_BAR_HOLES_RATIO` = 0.01）。 */
  maxHolesRatio: number;
  /** fillness 动态范围低于此值判全满/全空（默认 `FULL_EMPTY_DELTA` = 6）。 */
  fullEmptyDelta: number;
}

// ---------------------------------------------------------------------------
// 数字识别结果 ReadDigitsResult（架构 §3.1）
// ---------------------------------------------------------------------------

/** 单个字形的匹配得分。 */
export interface GlyphScore {
  /** 候选字符。 */
  ch: string;
  /** NCC 得分。 */
  score: number;
}

/** 数字（模板匹配）识别结果。 */
export interface ReadDigitsResult {
  /** 解析后的数值。 */
  value: number;
  /** 原始识别文本（含 `,` `%` 等符号）。 */
  text: string;
  /** 整体置信度 0–1（取各字形最低分）。 */
  confidence: number;
  /** top1 − top2 的最小间隔（拒识判定用）。 */
  minMargin: number;
  /** 各字形的候选得分。 */
  glyphScores: GlyphScore[][];
}

/** `readDigits` 的可选参数。 */
export interface ReadDigitsOptions {
  /** 模板匹配置信度下限（默认 `NCC_MIN` = 0.55）。 */
  nccMin: number;
  /** top1−top2 最小间隔（默认 `NCC_MARGIN` = 0.03）。 */
  nccMargin: number;
  /** 允许的字符集（默认 `'0123456789%,./'`）。 */
  allowChars: string;
}

// ---------------------------------------------------------------------------
// 读数 ExpReading（架构 §3.2）
// ---------------------------------------------------------------------------

/**
 * 一次读数（用于交叉校验的输入）。
 * `absolute` 或 `ratio` 任一为 `null` 即视为无效读数。
 */
export interface ExpReading {
  /** 文字读数（经验数值）；识别失败为 `null`。 */
  absolute: number | null;
  /** 像素比例 0–1；识别失败为 `null`。 */
  ratio: number | null;
  /** 该读数是否为估算值（未通过严格阈值）。 */
  estimated: boolean;
  /** 已知的本级所需经验（若已知）；未知为 `null`。 */
  requiredExp: number | null;
  /** 该读数对应的源帧时刻（ms）。 */
  sourceAt: number;
}

/**
 * 创建一个读数对象（缺省字段填 `null` / `false`）。
 *
 * @param absolute 文字读数或 `null`。
 * @param ratio 像素比例或 `null`。
 * @param sourceAt 源帧时刻（ms）。
 * @param estimated 是否为估算值，默认 `false`。
 * @param requiredExp 已知本级所需经验，默认 `null`。
 * @returns 新 `ExpReading`。
 */
export function createExpReading(
  absolute: number | null,
  ratio: number | null,
  sourceAt: number,
  estimated = false,
  requiredExp: number | null = null,
): ExpReading {
  return { absolute, ratio, estimated, requiredExp, sourceAt };
}

/**
 * 判断一次读数是否有效（`absolute` 与 `ratio` 均非空且为正）。
 *
 * @param reading 读数。
 * @returns 是否有效。
 */
export function isReadingUsable(reading: ExpReading): boolean {
  return (
    reading.absolute !== null &&
    reading.absolute > 0 &&
    reading.ratio !== null &&
    reading.ratio > 0
  );
}

/** 供 `columnProfile` 复用的区域入参（与 `RegionRect` 一致）。 */
export type ProfileRect = RegionRect;
