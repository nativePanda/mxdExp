/**
 * 等级进度 —— `level + expNeeded + currentExp` → `LevelInfo`。
 *
 * 纯函数，零 DOM 依赖。
 *
 * 语义（PRD §6.6）：
 * - `expPercent` 为当前百分比 0–100；
 * - `expToNext = expNeeded − currentExp`（下限 0）。
 */

import type { LevelInfo } from '@/types';

/**
 * 由等级、本级共需经验、当前经验生成 `LevelInfo`。
 *
 * @param level 当前等级。
 * @param expNeeded 本级共需经验；未知传 `null`。
 * @param currentExp 当前经验（本级内）；未知传 `null`。
 * @returns `LevelInfo`；经验不可用时 `expPercent=0`、`expToNext=0`。
 */
export function levelProgress(
  level: number,
  expNeeded: number | null,
  currentExp: number | null,
): LevelInfo {
  const lvl = Number.isFinite(level) ? Math.round(level) : 0;
  const needed = expNeeded !== null && Number.isFinite(expNeeded) && expNeeded > 0 ? expNeeded : null;
  const cur = currentExp !== null && Number.isFinite(currentExp) && currentExp >= 0 ? currentExp : null;

  if (needed === null || cur === null) {
    return {
      level: lvl,
      currentExp: cur ?? 0,
      expPercent: 0,
      expNeeded: needed ?? 0,
      expToNext: 0,
    };
  }

  const expPercent = Math.min(100, Math.max(0, (cur / needed) * 100));
  const expToNext = Math.max(0, needed - cur);

  return {
    level: lvl,
    currentExp: cur,
    expPercent,
    expNeeded: needed,
    expToNext,
  };
}

/**
 * 由当前经验与共需经验推算百分比（0–100）。
 *
 * @param currentExp 当前经验。
 * @param expNeeded 本级共需经验。
 * @returns 百分比；入参无效时返回 `null`（拒识）。
 */
export function expPercent(currentExp: number | null, expNeeded: number | null): number | null {
  if (currentExp === null || expNeeded === null) return null;
  if (!Number.isFinite(currentExp) || !Number.isFinite(expNeeded) || expNeeded <= 0) return null;
  return Math.min(100, Math.max(0, (currentExp / expNeeded) * 100));
}

/**
 * 距升级所需经验。
 *
 * @param currentExp 当前经验。
 * @param expNeeded 本级共需经验。
 * @returns 距升级经验（≥ 0）；入参无效时返回 `null`。
 */
export function expToNext(currentExp: number | null, expNeeded: number | null): number | null {
  if (currentExp === null || expNeeded === null) return null;
  if (!Number.isFinite(currentExp) || !Number.isFinite(expNeeded)) return null;
  return Math.max(0, expNeeded - currentExp);
}
