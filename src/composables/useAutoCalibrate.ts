/**
 * `useAutoCalibrate` —— 校准辅助（区域定位状态巡检 + 一键「按默认布局」填充）。
 *
 * 依据：架构文档 §2.12 / §5.2（校准流程）。
 *
 * ## 职责（P0 可落地的最小自动化，如实标注）
 * - **巡检**：给定校准配置，报告哪些必填区域仍无效（矩形宽高为 0）；
 * - **按默认布局填充**：把 6 区域快速铺到画面下方（供用户在此基础上微调），
 *   并可选地把 `expBar`/`expText` 联动为同矩形（`expSplit=false`）；
 * - 真正的「像素级自动识别经验条位置」属 P1，本模块**不伪造**该能力。
 *
 * 纯逻辑部分（校验 / 默认布局生成）抽为独立纯函数，便于单测；组合式只做薄封装。
 */

import type { CalibrationConfig, Region, RegionKey, RegionRect } from '@/types/calibration';
import { REGION_KEY_VALUES, isRectValid } from '@/types/calibration';
import { createDefaultRegions, REGION_META } from '@/constants/regions';

/** 巡检结果。 */
export interface CalibrationCheckResult {
  /** 是否全部必填区域有效。 */
  ok: boolean;
  /** 无效的必填区域键。 */
  missingRequired: RegionKey[];
  /** 已定位（状态为 `located` 且矩形有效）的区域键。 */
  located: RegionKey[];
}

/**
 * 巡检一份校准配置。
 *
 * @param config 校准配置。
 * @returns 巡检结果。
 */
export function checkCalibration(config: CalibrationConfig): CalibrationCheckResult {
  const missingRequired: RegionKey[] = [];
  const located: RegionKey[] = [];
  for (const key of REGION_KEY_VALUES) {
    const region: Region | undefined = config.regions[key];
    const valid = !!region && isRectValid(region);
    if (!valid && REGION_META[key].required) missingRequired.push(key);
    if (valid && region.status === 'located') located.push(key);
  }
  return { ok: missingRequired.length === 0, missingRequired, located };
}

/**
 * 生成「按默认布局」的区域表（全部置为 `located`，便于一键起步后微调）。
 *
 * @param expSplit 是否拆分经验条 / 经验数值框，默认 `false`（同矩形）。
 * @returns 6 键区域映射。
 */
export function buildDefaultLayout(expSplit = false): Record<RegionKey, Region> {
  const base = createDefaultRegions();
  const out = { ...base };
  for (const key of REGION_KEY_VALUES) {
    out[key] = { ...base[key], status: 'located' };
  }
  if (!expSplit) {
    out.expText = { ...out.expBar };
  }
  return out;
}

/**
 * 把区域矩形按给定尺寸归一化（0–1）—— 仅用于默认布局的比例换算。
 *
 * @param x 像素 x。
 * @param y 像素 y。
 * @param w 像素宽。
 * @param h 像素高。
 * @param sourceW 原宽。
 * @param sourceH 原高。
 * @returns 归一化矩形。
 */
export function normalizeRect(
  x: number,
  y: number,
  w: number,
  h: number,
  sourceW: number,
  sourceH: number,
): RegionRect {
  const sw = sourceW > 0 ? sourceW : 1;
  const sh = sourceH > 0 ? sourceH : 1;
  return { x: x / sw, y: y / sh, w: w / sw, h: h / sh };
}

/**
 * 创建自动校准辅助实例（薄封装，纯逻辑见上方导出函数）。
 *
 * @returns 辅助方法集合。
 */
export function useAutoCalibrate(): {
  check: (config: CalibrationConfig) => CalibrationCheckResult;
  defaultLayout: (expSplit?: boolean) => Record<RegionKey, Region>;
} {
  return {
    check: checkCalibration,
    defaultLayout: buildDefaultLayout,
  };
}
