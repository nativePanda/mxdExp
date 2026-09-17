/**
 * 速率指标计算 —— 纯函数，零 DOM 依赖。
 *
 * 硬约定（架构 §5.2）：**「经验/小时」等速率一律用真实时间跨度计算**（`deltaExp / deltaMs`），
 * **绝不用帧数**推算 —— 因为后台节流会导致掉帧，用帧数会算错。
 */

/** 一小时对应的毫秒数。 */
export const MS_PER_HOUR = 3_600_000;

/**
 * 由经验增量与真实时间跨度计算「经验/小时」。
 *
 * @param deltaExp 经验增量（可为负，用于恢复/修正场景）。
 * @param deltaMs 真实时间跨度（ms）。
 * @returns 经验/小时；`deltaMs <= 0` 或非有限时返回 `null`（拒识，不猜测）。
 */
export function expPerHour(deltaExp: number | null, deltaMs: number | null): number | null {
  if (deltaExp === null || deltaMs === null) return null;
  if (!Number.isFinite(deltaExp) || !Number.isFinite(deltaMs)) return null;
  if (deltaMs <= 0) return null;
  return (deltaExp / deltaMs) * MS_PER_HOUR;
}

/**
 * 由金币增量与真实时间跨度计算「金币/小时」。
 *
 * @param deltaGold 金币增量。
 * @param deltaMs 真实时间跨度（ms）。
 * @returns 金币/小时；入参无效或 `deltaMs <= 0` 时返回 `null`。
 */
export function goldPerHour(deltaGold: number | null, deltaMs: number | null): number | null {
  return expPerHour(deltaGold, deltaMs);
}

/**
 * 计算净经验增量。
 *
 * @param startExp 起始经验。
 * @param endExp 结束经验。
 * @returns 净经验（`end - start`）；任一为 `null` 时返回 `null`。
 */
export function netExp(startExp: number | null, endExp: number | null): number | null {
  if (startExp === null || endExp === null) return null;
  if (!Number.isFinite(startExp) || !Number.isFinite(endExp)) return null;
  return endExp - startExp;
}

/**
 * 真实时间跨度（ms）。
 *
 * @param startMs 起始时刻。
 * @param endMs 结束时刻。
 * @returns 跨度；非法或为负时返回 0。
 */
export function durationMs(startMs: number | null, endMs: number | null): number {
  if (startMs === null || endMs === null) return 0;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, endMs - startMs);
}
