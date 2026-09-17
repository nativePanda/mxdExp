/**
 * 纯判定守卫 —— 移植枫记相关判定函数（`probe/_estimator_pretty.js` 第 62–65 行）。
 *
 * 全部为纯函数，零 DOM 依赖：
 * - `isValidReading` —— 读数是否有效（同时由 `rangeFromReading.ts` 导出，此处为守卫聚合入口）；
 * - `isValidLevel`   —— 等级是否在合法范围内；
 * - `toRequiredExp`  —— 归一化 requiredExp（非法 → `null`）；
 * - `isMonotonicSample` —— 两次候选样本是否单调（同等级内经验应单调不减）。
 */

import type { ExpReading } from '@/types';
import { LEVEL_MAX, LEVEL_MIN, MONO_EPS } from '@/constants';
import { intersectRanges, isValidReading, type Range } from './rangeFromReading';

/**
 * 读数是否有效（转发 `rangeFromReading.isValidReading`，作为守卫模块的统一入口）。
 *
 * @param reading 读数。
 * @returns 是否有效。
 */
export function isValidReadingGuard(
  reading: Pick<ExpReading, 'absolute' | 'ratio' | 'estimated'>,
): boolean {
  return isValidReading(reading);
}

export { isValidReading };

/**
 * 等级是否合法（`LEVEL_MIN ≤ level ≤ LEVEL_MAX`，且为整数）。
 *
 * @param level 等级。
 * @returns 是否合法。
 */
export function isValidLevel(level: number): boolean {
  return Number.isInteger(level) && level >= LEVEL_MIN && level <= LEVEL_MAX;
}

/**
 * 归一化 requiredExp：合法（安全整数且 > 0）返回原值，否则返回 `null`。
 *
 * @param value 待校验值。
 * @returns requiredExp 或 `null`。
 */
export function toRequiredExp(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** 候选样本（枫记 `CandidateSample`）。 */
export interface CandidateSample {
  /** 文字读数。 */
  absolute: number;
  /** 像素比例。 */
  ratio: number;
  /** 由该读数反推的 requiredExp 区间。 */
  range: Range;
  /** 源帧时刻（ms）。 */
  sourceAt: number;
}

/**
 * 判断新样本相对上一样本是否**单调**（枫记 `isMonotonicSample`）。
 *
 * 规则：`sourceAt` 递增、`absolute` 不减、`ratio` 不低于 `MONO_EPS` 的容差，
 * 且两区间有交集。
 *
 * @param prev 上一候选样本。
 * @param next 新候选样本。
 * @returns 是否单调可续。
 */
export function isMonotonicSample(prev: CandidateSample, next: CandidateSample): boolean {
  if (!prev || !next) return false;
  return (
    next.sourceAt > prev.sourceAt &&
    next.absolute >= prev.absolute &&
    next.ratio >= prev.ratio - MONO_EPS &&
    intersectRanges([prev.range, next.range]) !== undefined
  );
}
