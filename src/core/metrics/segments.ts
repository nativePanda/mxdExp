/**
 * 记录区间（`Segment`）维护 —— 纯函数，零 DOM 依赖。
 *
 * 语义（架构 §3.3 / §5.3）：
 * - `Segment` 表示一段**连续统计区间** `[startT, endT]`；
 * - 中断（暂停 / 遮挡 / 掉线）会**关闭**当前区间；恢复后**开启新区间**并标记
 *   `isRecoveredStart=true`（对应 `ReadState='recovered'`：恢复后效率只统计恢复后的连续区间）；
 * - `confirmed` 标记该区间是否已通过交叉校验。
 */

import type { Segment } from '@/types';

/**
 * 创建一个区间。
 *
 * @param startT 起始时刻（ms）。
 * @param isRecoveredStart 是否为恢复起点，默认 `false`。
 * @returns 新区间（`endT` 先等于 `startT`，`confirmed=false`）。
 */
export function createSegment(startT: number, isRecoveredStart = false): Segment {
  return { startT, endT: startT, isRecoveredStart, confirmed: false };
}

/**
 * 关闭一个区间（设定 `endT`）。
 *
 * @param seg 区间。
 * @param endT 结束时刻（ms）。
 * @param confirmed 是否已确认，默认 `false`。
 * @returns 新区间（不修改入参）。
 */
export function closeSegment(seg: Segment, endT: number, confirmed = false): Segment {
  return { ...seg, endT: Math.max(seg.startT, endT), confirmed };
}

/**
 * 延长区间的结束时刻（逐帧推进）。
 *
 * @param seg 区间。
 * @param t 当前时刻（ms）。
 * @returns 新区间。
 */
export function extendSegment(seg: Segment, t: number): Segment {
  return { ...seg, endT: Math.max(seg.endT, t) };
}

/**
 * 计算区间时长（ms）。
 *
 * @param seg 区间。
 * @returns 时长（≥ 0）。
 */
export function segmentDuration(seg: Segment): number {
  return Math.max(0, seg.endT - seg.startT);
}

/**
 * 计算多个区间的**总时长**（ms）。
 *
 * @param segments 区间列表。
 * @returns 总时长。
 */
export function totalDuration(segments: Segment[]): number {
  let sum = 0;
  for (const s of segments) sum += segmentDuration(s);
  return sum;
}

/**
 * 计算多个区间中**已确认**区间的总时长（ms）。
 *
 * 用途：`netExp` 在存在未确认区间时置 `null`（PRD P0-8）。
 *
 * @param segments 区间列表。
 * @returns 已确认总时长。
 */
export function confirmedDuration(segments: Segment[]): number {
  let sum = 0;
  for (const s of segments) if (s.confirmed) sum += segmentDuration(s);
  return sum;
}

/**
 * 判断是否存在**未确认**区间。
 *
 * @param segments 区间列表。
 * @returns 是否存在未确认区间。
 */
export function hasUnconfirmedSegment(segments: Segment[]): boolean {
  return segments.some((s) => !s.confirmed);
}

/**
 * 汇总当前区间的总时长与已确认时长。
 *
 * @param segments 区间列表。
 * @returns `{total, confirmed, hasUnconfirmed}`。
 */
export function summarizeSegments(segments: Segment[]): {
  total: number;
  confirmed: number;
  hasUnconfirmed: boolean;
} {
  return {
    total: totalDuration(segments),
    confirmed: confirmedDuration(segments),
    hasUnconfirmed: hasUnconfirmedSegment(segments),
  };
}
