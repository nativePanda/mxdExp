/**
 * 校准相关类型：区域框选（归一化坐标）、区域键与校准配置。
 *
 * 硬约定：
 * - 所有 `Region` 一律为 **0–1 相对坐标**，相对**原始视频尺寸**（不是 canvas 显示尺寸）。
 *   像素换算统一走 `FrameGrabber.grabRect(norm)`，禁止在组件里直接算像素。
 * - 区域清单定稿为 **6 个**：`expBar` / `expText` / `level` / `gold` / `hp` / `mp`
 *   （架构文档 §3.5.1 / §5.9）。`RegionKey` 是区域清单的**唯一真相源**，
 *   元数据表 `REGION_META` 见 `src/constants/regions.ts`。
 */

import type { RegionStatus } from './enums';

/**
 * 六个可框选区域的键（架构 §3.5.1 定稿）。
 *
 * - `expBar`：经验条填充区 → 供 `columnProfile` 算比例；
 * - `expText`：经验数值文字 → 供 `readDigits` 读当前经验绝对值；
 *   （`expBar` 与 `expText` 是**同一物理区域的两种测量**，默认同矩形，见 `CalibrationConfig.expSplit`）
 * - `level`：等级数字（**选填**，缺失时升级检测降级）；
 * - `gold`：金币数值；
 * - `hp` / `mp`：角色状态（选填，P1）。
 */
export type RegionKey = 'expBar' | 'expText' | 'level' | 'gold' | 'hp' | 'mp';

/** `RegionKey` 的合法取值列表（顺序与架构 §3.5.1 表格一致）。 */
export const REGION_KEY_VALUES: readonly RegionKey[] = [
  'expBar',
  'expText',
  'level',
  'gold',
  'hp',
  'mp',
] as const;

/** 矩形（归一化坐标，0–1，相对原始视频尺寸）。 */
export interface RegionRect {
  /** 左上角 x（0–1）。 */
  x: number;
  /** 左上角 y（0–1）。 */
  y: number;
  /** 宽度（0–1）。 */
  w: number;
  /** 高度（0–1）。 */
  h: number;
}

/** 一个可框选区域：归一化矩形 + 定位状态。 */
export interface Region extends RegionRect {
  /** 定位状态：located / unlocated / identifying。 */
  status: RegionStatus;
}

/** 六个区域键 → 区域对象的映射（恒为 6 键）。 */
export type CalibrationRegions = Record<RegionKey, Region>;

/** 校准配置（PRD §6.7 / 架构 §3.5.1）。 */
export interface CalibrationConfig {
  /** 配置版本（分辨率变化时需重标）。 */
  version: number;
  /** 绑定分辨率 + 设备像素比 + UA 摘要的指纹。 */
  screenKey: string;
  /** 六个区域的框选结果；选填 / 未校准的键 `status='unlocated'`。 */
  regions: CalibrationRegions;
  /**
   * 是否已拆分经验条与经验数值框。
   * - `false`（默认）：`expBar` 与 `expText` 联动为**同一矩形**，用户只画一次；
   *   采集循环只抓一次帧、复用同一 `ImageData` 给 `columnProfile` 与 `readDigits`（性能优化）。
   * - `true`：两者已拆为独立矩形，采集时各抓一次帧。
   */
  expSplit: boolean;
  /** 最近保存时间戳（`Date.now()`）。 */
  updatedAt: number;
}

/**
 * 创建一个归一化矩形。
 *
 * @param x 左上角 x（0–1）。
 * @param y 左上角 y（0–1）。
 * @param w 宽度（0–1）。
 * @param h 高度（0–1）。
 * @returns 归一化矩形。
 */
export function createRect(x: number, y: number, w: number, h: number): RegionRect {
  return { x, y, w, h };
}

/**
 * 创建一个区域（带默认定位状态 `unlocated`）。
 *
 * @param x 左上角 x（0–1）。
 * @param y 左上角 y（0–1）。
 * @param w 宽度（0–1）。
 * @param h 高度（0–1）。
 * @param status 定位状态，默认 `unlocated`。
 * @returns 区域对象。
 */
export function createRegion(
  x: number,
  y: number,
  w: number,
  h: number,
  status: RegionStatus = 'unlocated',
): Region {
  return { x, y, w, h, status };
}

/**
 * 把归一化矩形裁剪到 [0,1] 范围内（防止拖拽越界产生非法坐标）。
 *
 * @param rect 待裁剪的矩形。
 * @returns 新的合规矩形。
 */
export function clampRect(rect: RegionRect): RegionRect {
  const x = Math.min(Math.max(rect.x, 0), 1);
  const y = Math.min(Math.max(rect.y, 0), 1);
  const w = Math.min(Math.max(rect.w, 0), 1 - x);
  const h = Math.min(Math.max(rect.h, 0), 1 - y);
  return { x, y, w, h };
}

/**
 * 把归一化矩形转换为像素矩形。
 *
 * @param rect 归一化矩形（0–1）。
 * @param sourceW 原始像素宽度（如 `video.videoWidth`）。
 * @param sourceH 原始像素高度（如 `video.videoHeight`）。
 * @returns 像素整数矩形 `{x,y,w,h}`。
 */
export function rectToPixels(
  rect: RegionRect,
  sourceW: number,
  sourceH: number,
): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.round(rect.x * sourceW));
  const y = Math.max(0, Math.round(rect.y * sourceH));
  const w = Math.max(1, Math.round(rect.w * sourceW));
  const h = Math.max(1, Math.round(rect.h * sourceH));
  return { x, y, w, h };
}

/**
 * 判断两个区域是否占据完全相同的矩形（忽略 `status`）。
 *
 * 用途：`expSplit=false` 时，采集循环据此判定「`expBar` 与 `expText` 同矩形 → 只抓一次帧」。
 *
 * @param a 区域 A。
 * @param b 区域 B。
 * @returns 矩形是否完全相同。
 */
export function isSameRect(a: RegionRect, b: RegionRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * 判断某一区域的矩形是否有效（宽高均 > 0）。
 *
 * @param region 区域。
 * @returns 是否有效。
 */
export function isRectValid(region: RegionRect): boolean {
  return region.w > 0 && region.h > 0;
}

/**
 * 判断某个区域是否已可被采集（矩形有效）。
 *
 * 说明：`located` 表示已定位；但即使 `status` 仍为 `unlocated`，只要矩形有效也可采
 * （「全部恢复默认」会同时清空矩形与状态）。
 *
 * @param region 区域。
 * @returns 是否可用。
 */
export function isRegionUsable(region: Region): boolean {
  return isRectValid(region);
}

// ---------------------------------------------------------------------------
// 编译期断言：`RegionKey` 必须恰好是 6 元联合类型
// ---------------------------------------------------------------------------

/**
 * 编译期互斥断言：`RegionKey` 与定稿的 6 元字面量联合类型必须**互相可赋值**。
 *
 * 若有人给 `RegionKey` 增删成员，此处的类型不匹配会立刻导致 `vue-tsc` 报错，
 * 从而在编译期守住「区域清单为 6 个」这条硬约定（架构 §3.5.1）。
 */
type RegionKeyExhaustiveCheck =
  RegionKey extends 'expBar' | 'expText' | 'level' | 'gold' | 'hp' | 'mp'
    ? 'expBar' | 'expText' | 'level' | 'gold' | 'hp' | 'mp' extends RegionKey
      ? true
      : never
    : never;

/** 该常量赋值为 `true` 即代表上述编译期断言通过。 */
export const REGION_KEY_IS_SIX: RegionKeyExhaustiveCheck = true;
