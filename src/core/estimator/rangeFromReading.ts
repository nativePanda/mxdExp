/**
 * 由 (数值, 比例) 反推「本级所需经验」区间 —— **移植枫记 `exp-requirement-estimator`**。
 *
 * 算法来源（只读参考，不 import）：`probe/_estimator_pretty.js` 第 40–54 行
 * 与 `probe/exp3_validate.js`。核心：
 *
 * ```
 * tol     = 0.5 * 10^(-precision) / 100
 * rMin    = max(2^-52, ratio - tol)
 * rMax    = min(1, ratio + tol)
 * minimum = max(absolute, ceil(absolute / rMax))
 * maximum = floor(absolute / rMin)
 * ```
 *
 * 返回值语义**严格区分**（枫记原实现即如此）：
 * - `null`      —— **空条**（`absolute === 0 && ratio === 0`）；
 * - `undefined` —— **无效读数**（读不到 / 参数非法 / 算出的区间非法）；
 * - `Range`     —— 可行区间 `{minimum, maximum}`。
 *
 * 纯函数，零 DOM 依赖。
 */

import type { ExpReading } from '@/types';
import { PERCENTAGE_PRECISION } from '@/constants';

/** 本级所需经验的可行区间（闭区间，整数）。 */
export interface Range {
  /** 下界（含）。 */
  minimum: number;
  /** 上界（含）。 */
  maximum: number;
}

/** `2^-52`：枫记原实现使用的浮点下界（避免除零）。 */
const FLOAT_MIN = 2 ** -52;

/**
 * 由一次读数反推「本级所需经验」的可行区间。
 *
 * @param reading 读数（至少需要 `absolute` 与 `ratio`）。
 * @param precision 百分比小数位（0–4），默认 `PERCENTAGE_PRECISION`（2）。
 * @returns `Range`（可行区间）、`null`（空条）或 `undefined`（无效读数）。
 */
export function rangeFromReading(
  reading: Pick<ExpReading, 'absolute' | 'ratio'>,
  precision: number = PERCENTAGE_PRECISION,
): Range | null | undefined {
  const absolute = reading?.absolute;
  const ratio = reading?.ratio;

  // 参数合法性（与枫记一致）
  if (
    absolute === null ||
    absolute === undefined ||
    ratio === null ||
    ratio === undefined ||
    !Number.isSafeInteger(absolute) ||
    absolute < 0 ||
    !Number.isFinite(ratio) ||
    ratio < 0 ||
    ratio > 1 ||
    !Number.isInteger(precision) ||
    precision < 0 ||
    precision > 4
  ) {
    return undefined;
  }

  // 空条：数值与比例都为 0 → 明确语义 `null`（不是"读不到"）。
  if (absolute === 0 && ratio === 0) return null;

  // 读到 0 值（但非空条）→ 无效。
  if (absolute <= 0 || ratio <= 0) return undefined;

  const tol = (0.5 * 10 ** -precision) / 100;
  const rMin = Math.max(FLOAT_MIN, ratio - tol);
  const rMax = Math.min(1, ratio + tol);

  const minimum = Math.max(absolute, Math.ceil(absolute / rMax));
  const maximum = Math.floor(absolute / rMin);

  if (
    Number.isSafeInteger(minimum) &&
    Number.isSafeInteger(maximum) &&
    minimum > 0 &&
    maximum >= minimum
  ) {
    return { minimum, maximum };
  }
  return undefined;
}

/**
 * 多个区间取交集（`max(minimums)` vs `min(maximums)`）。
 *
 * @param ranges 区间列表。
 * @returns 交集区间；列表为空或交集为空时返回 `undefined`。
 */
export function intersectRanges(ranges: Range[]): Range | undefined {
  if (!Array.isArray(ranges) || ranges.length === 0) return undefined;

  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  for (const r of ranges) {
    if (!r) return undefined;
    if (r.minimum > lo) lo = r.minimum;
    if (r.maximum < hi) hi = r.maximum;
  }
  return lo <= hi ? { minimum: lo, maximum: hi } : undefined;
}

/**
 * 判断某值是否落在区间内。
 *
 * @param range 区间。
 * @param value 待判定值（要求为安全整数）。
 * @returns 是否包含。
 */
export function rangeContains(range: Range, value: number): boolean {
  return Number.isSafeInteger(value) && value >= range.minimum && value <= range.maximum;
}

/**
 * 从区间取一个代表值（枫记 `pick`）。
 *
 * 规则：若 `requiredExp` 已知且落在区间内 → 取 `max(floor, round(requiredExp))`；
 * 否则取区间**中点**再 `max(floor, ...)`。
 *
 * @param range 区间。
 * @param floor 下界（默认 0）。
 * @param requiredExp 已知的 requiredExp（`null` 表示未知）。
 * @returns 代表值。
 */
export function pickFromRange(
  range: Range,
  floor = 0,
  requiredExp?: number | null,
): number {
  const rounded = requiredExp === null || requiredExp === undefined ? null : Math.round(requiredExp);
  if (rounded !== null && Number.isSafeInteger(rounded) && rangeContains(range, rounded)) {
    return Math.max(floor, rounded);
  }
  return Math.max(floor, Math.round((range.minimum + range.maximum) / 2));
}

/**
 * 由读数估算 requiredExp（`absolute / ratio` 的单点估计）。
 *
 * @param reading 读数。
 * @returns 估算值；无效时返回 `null`。
 */
export function ratioToAbsolute(reading: Pick<ExpReading, 'absolute' | 'ratio'>): number | null {
  const absolute = reading?.absolute;
  const ratio = reading?.ratio;
  if (absolute === null || absolute === undefined) return null;
  if (ratio === null || ratio === undefined || ratio === 0) return null;
  const v = absolute / ratio;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * 判断读数与已知 `requiredExp` 是否自洽（交叉校验）。
 *
 * @param reading 读数。
 * @param requiredExp 已知的本级所需经验（`null` 表示"已确认为空条"）。
 * @param precision 百分比小数位，默认 `PERCENTAGE_PRECISION`。
 * @returns 是否自洽。
 */
export function isConsistent(
  reading: Pick<ExpReading, 'absolute' | 'ratio' | 'estimated'>,
  requiredExp: number | null,
  precision: number = PERCENTAGE_PRECISION,
): boolean {
  if (!isValidReading(reading)) return false;
  if (reading.absolute === 0 && reading.ratio === 0) return true;
  if (requiredExp === null || requiredExp <= 0) return false;

  const rng = rangeFromReading(reading, precision);
  return rng !== null && rng !== undefined && rangeContains(rng, requiredExp);
}

/**
 * 读数是否**有效**（枫记 `validReading`）。
 *
 * 要求：`absolute` 与 `ratio` 均非 `null`、非估算、`absolute` 为安全整数且 ≥ 0、
 * `ratio` 为有限数且 ∈ [0,1]。
 *
 * @param reading 读数。
 * @returns 是否有效。
 */
export function isValidReading(
  reading: Pick<ExpReading, 'absolute' | 'ratio' | 'estimated'>,
): boolean {
  if (!reading) return false;
  const { absolute, ratio, estimated } = reading;
  return (
    absolute !== null &&
    absolute !== undefined &&
    ratio !== null &&
    ratio !== undefined &&
    !estimated &&
    Number.isSafeInteger(absolute) &&
    absolute >= 0 &&
    Number.isFinite(ratio) &&
    ratio >= 0 &&
    ratio <= 1
  );
}
