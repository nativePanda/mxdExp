/**
 * 效率分档 —— 纯函数，零 DOM 依赖。
 *
 * 分档（PRD P0-12 / 架构 §2.7）：`low` / `mid` / `high` / `veryHigh`
 * （较低 / 中间 / 较高 / 高效）。
 *
 * ⚠️ 分档阈值说明：架构 §10 A2 标注「具体值待有真实数据后标定」。本实现采用
 * **显式可覆写的默认阈值**（经验/小时），并在文档中如实标注为待标定项 ——
 * 不硬编码为不可修改的魔法数字。
 */

import type { EfficiencyTier } from '@/types';

/**
 * 效率分档的默认阈值（经验/小时，升序区间的上界）。
 *
 * - `< mid`            → `low`
 * - `[mid, high)`      → `mid`
 * - `[high, veryHigh)` → `high`
 * - `>= veryHigh`      → `veryHigh`
 *
 * 取值依据：以怀旧服常见练级速率量级（数十万~数百万经验/小时）粗分；
 * A2 待标定，调用方可传入自定义阈值覆盖。
 */
export const EFFICIENCY_THRESHOLDS = {
  /** mid 档下界（经验/小时）。 */
  mid: 500_000,
  /** high 档下界（经验/小时）。 */
  high: 1_500_000,
  /** veryHigh 档下界（经验/小时）。 */
  veryHigh: 3_000_000,
} as const;

/** 效率分档阈值类型。 */
export interface EfficiencyTierThresholds {
  /** mid 档下界。 */
  mid: number;
  /** high 档下界。 */
  high: number;
  /** veryHigh 档下界。 */
  veryHigh: number;
}

/**
 * 由经验/小时给出效率档位。
 *
 * @param expPerHour 经验/小时；`null` / 非有限视为 `low`。
 * @param thresholds 自定义阈值，默认 `EFFICIENCY_THRESHOLDS`。
 * @returns `EfficiencyTier`。
 */
export function efficiencyTier(
  expPerHour: number | null,
  thresholds: EfficiencyTierThresholds = EFFICIENCY_THRESHOLDS,
): EfficiencyTier {
  if (expPerHour === null || !Number.isFinite(expPerHour)) return 'low';
  if (expPerHour >= thresholds.veryHigh) return 'veryHigh';
  if (expPerHour >= thresholds.high) return 'high';
  if (expPerHour >= thresholds.mid) return 'mid';
  return 'low';
}

/**
 * 效率档位 → 简短说明文案（补充 `types/enums.ts` 的 `EFFICIENCY_TIER_TEXT`）。
 *
 * @param tier 档位。
 * @returns 说明文案。
 */
export function efficiencyTierDesc(tier: EfficiencyTier): string {
  switch (tier) {
    case 'low':
      return '当前效率处于较低水平';
    case 'mid':
      return '当前效率处于中间水平';
    case 'high':
      return '当前效率处于较高水平';
    case 'veryHigh':
      return '当前效率处于高效水平';
    default:
      return '效率水平未知';
  }
}
