/**
 * `core/metrics/isExpRatioDiscontinuity` 单测 —— 经验条比例「不连续下降」谓词。
 *
 * 验收（架构 §5.9 / §7-T02 第 7 条）：
 * - `prev=0.9, ratio=0.1` → true（下降 0.8 > 0.5）；
 * - `prev=0.1, ratio=0.9`（上升）→ false（单向，只算下降）；
 * - 任一方为 `null` → false；
 * - 差值恰等于 0.5 → false（**严格大于**才触发）。
 */

import { describe, expect, it } from 'vitest';
import { isExpRatioDiscontinuity } from '@/core/metrics';
import { LEVEL_DISCONTINUITY_ABS } from '@/constants';

describe('isExpRatioDiscontinuity —— 单向下降谓词', () => {
  it('比例突降 >0.5 → true（升级/换角色重置）', () => {
    expect(isExpRatioDiscontinuity(0.9, 0.1)).toBe(true);
    expect(isExpRatioDiscontinuity(1, 0)).toBe(true);
    expect(isExpRatioDiscontinuity(0.8, 0.29)).toBe(true); // 0.51 > 0.5
  });

  it('比例上升 → false（单向，只算下降）', () => {
    expect(isExpRatioDiscontinuity(0.1, 0.9)).toBe(false);
    expect(isExpRatioDiscontinuity(0.2, 0.21)).toBe(false);
    expect(isExpRatioDiscontinuity(0, 1)).toBe(false);
  });

  it('小幅下降（≤ 阈值）→ false（高光抖动不误触发）', () => {
    expect(isExpRatioDiscontinuity(0.5, 0.49)).toBe(false);
    expect(isExpRatioDiscontinuity(0.5, 0.2)).toBe(false); // 0.3 ≤ 0.5
    expect(isExpRatioDiscontinuity(0.5, 0.5)).toBe(false); // 无变化
  });

  it('差值恰等于阈值 → false（严格大于才触发）', () => {
    expect(isExpRatioDiscontinuity(0.6, 0.1)).toBe(false); // 0.5 === 0.5
    expect(isExpRatioDiscontinuity(1, 0.5)).toBe(false); // 0.5 === 0.5
  });

  it('任一方为 null → false', () => {
    expect(isExpRatioDiscontinuity(null, 0.1)).toBe(false);
    expect(isExpRatioDiscontinuity(0.9, null)).toBe(false);
    expect(isExpRatioDiscontinuity(null, null)).toBe(false);
  });

  it('可传入自定义阈值', () => {
    expect(isExpRatioDiscontinuity(0.9, 0.1, 0.7)).toBe(true); // 0.8 > 0.7
    expect(isExpRatioDiscontinuity(0.9, 0.1, 0.8)).toBe(false); // 0.8 === 0.8
    expect(isExpRatioDiscontinuity(0.3, 0.2, 0.05)).toBe(true); // 0.1 > 0.05
  });

  it('非有限数 → false（稳健性）', () => {
    expect(isExpRatioDiscontinuity(Number.NaN, 0.1)).toBe(false);
    expect(isExpRatioDiscontinuity(0.9, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('默认阈值等于 LEVEL_DISCONTINUITY_ABS', () => {
    // 阈值 − ε 触发、阈值 + ε 不触发，交叉验证默认阈值取值。
    const eps = 1e-9;
    expect(isExpRatioDiscontinuity(0.5 + LEVEL_DISCONTINUITY_ABS + eps, 0.5)).toBe(true);
    expect(isExpRatioDiscontinuity(0.5 + LEVEL_DISCONTINUITY_ABS, 0.5)).toBe(false);
  });
});
