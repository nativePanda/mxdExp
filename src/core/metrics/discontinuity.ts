/**
 * 经验条比例「不连续下降」谓词 —— 纯函数，零 DOM 依赖。
 *
 * 语义（架构 §5.9）：
 * - **单向，只算下降**：`(prevRatio − ratio) > threshold` 才判不连续；
 * - 比例**上升**是正常推进（跨帧中值后的抖动 ≤1px），**绝不**判不连续；
 * - 任一方为 `null`（无效比例）→ `false`（不触发）；
 * - **严格大于**：差值恰等于阈值 **不**触发。
 *
 * 用途：T03 采集循环在每帧抓帧后调用；一旦命中，**立即强制重读等级**，
 * 不受 `LEVEL_READ_EVERY_N` 帧节奏约束（升级 / 换角色 / 断线等关键时刻不漏检）。
 *
 * 说明：经验**绝对值回退**（新读数低于本级已确认值）**不属于**本判定 ——
 * 那属于 estimator 的一致性判定（`isConsistent`），单位与量纲均不同，故本函数
 * **仅依赖 ratio**（架构 §5.9 明确「不新增常量、不进入本不连续判断」）。
 */

import { LEVEL_DISCONTINUITY_ABS } from '@/constants';

/**
 * 经验条比例是否发生「不连续下降」（升级 / 换角色 / 断线的早期信号）。
 *
 * @param prevRatio 上一有效比例（0–1）；无效传 `null`。
 * @param ratio 当前有效比例（0–1）；无效传 `null`。
 * @param threshold 幅度阈值，默认 `LEVEL_DISCONTINUITY_ABS`（0.5）。
 * @returns `true` 表示出现不连续下降、应触发立即重读等级。
 */
export function isExpRatioDiscontinuity(
  prevRatio: number | null,
  ratio: number | null,
  threshold: number = LEVEL_DISCONTINUITY_ABS,
): boolean {
  // 任一无效率 → 不触发（无可比对的基准）。
  if (prevRatio === null || prevRatio === undefined) return false;
  if (ratio === null || ratio === undefined) return false;

  // 非有限数一律视为无效。
  if (!Number.isFinite(prevRatio) || !Number.isFinite(ratio)) return false;

  // 单向：仅下降，且**严格**超过阈值（差值恰等于阈值不触发）。
  return prevRatio - ratio > threshold;
}
