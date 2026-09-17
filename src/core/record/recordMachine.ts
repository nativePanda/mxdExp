/**
 * 记录状态机（`RecordStatus`）迁移表与守卫 —— 纯函数，零 DOM / 零 Vue 依赖。
 *
 * 依据：架构文档 §3.3（`RecordSession` / `RecordStatus`）与 §7 T03-2。
 *
 * 合法全路径（架构 §7 T03-2 / team-lead 任务书）：
 * ```
 * idle → recording → paused → recording → finishing → saving → ended
 * ```
 *
 * 设计要点：
 * - 迁移表是**唯一真相源**：`canTransition(from, to)` 与 `nextStatus()` 都以此为准；
 * - 任何**未在表中登记**的迁移一律被拒（非法迁移不改变状态）；
 * - `ended` 为**终止态**，不能迁出（要再记录需新建会话）；
 * - 允许 `recording → finishing`（正常结束）、`paused → finishing`（暂停中结束）；
 * - 允许 `finishing → saved？`：`saving → ended`；
 * - 允许 `idle → ended`？否 —— 未开始不能直接结束。
 *
 * 说明：`RecordSession.start/pause/resume/finish` 内部都经本模块的 `canTransition`
 * 守卫，保证状态机语义单点可测。
 */

import type { RecordStatus } from '@/types/enums';

/**
 * 合法迁移表：`from → 允许到达的 to 集合`。
 *
 * 采用显式全量列举（而非"黑名单"），任何新增状态都必须在此登记，避免漏网非法迁移。
 */
export const RECORD_TRANSITIONS: Record<RecordStatus, readonly RecordStatus[]> = {
  // 未开始 → 只能开始记录。
  idle: ['recording'],
  // 记录中 → 可暂停 / 直接结束。
  recording: ['paused', 'finishing'],
  // 已暂停 → 可继续 / 结束。
  paused: ['recording', 'finishing'],
  // 正在结束 → 进入保存阶段（不可回退）。
  finishing: ['saving'],
  // 正在保存 → 保存完成。
  saving: ['ended'],
  // 已结束：终止态，无后续迁移。
  ended: [],
};

/**
 * 判断一次状态迁移是否合法。
 *
 * @param from 当前状态。
 * @param to 目标状态。
 * @returns 是否允许迁移；`from === to` 视为**合法**（幂等，不产生副作用）。
 */
export function canTransition(from: RecordStatus, to: RecordStatus): boolean {
  if (from === to) return true; // 幂等：重复设置同一状态不视为非法
  const allowed = RECORD_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * 执行一次状态迁移；非法迁移返回原状态（不抛错、不改变）。
 *
 * @param from 当前状态。
 * @param to 目标状态。
 * @returns 迁移后的状态（合法时为 `to`，非法时为 `from`）。
 */
export function nextStatus(from: RecordStatus, to: RecordStatus): RecordStatus {
  return canTransition(from, to) ? to : from;
}

/**
 * 判断某状态是否为**终止态**（不能再迁出）。
 *
 * @param status 状态。
 * @returns 是否终止态。
 */
export function isTerminalStatus(status: RecordStatus): boolean {
  return RECORD_TRANSITIONS[status].length === 0;
}

/**
 * 判断某状态是否处于"正在记录"语义（`recording`）。
 *
 * @param status 状态。
 * @returns 是否为记录中。
 */
export function isRecordingStatus(status: RecordStatus): boolean {
  return status === 'recording';
}

/**
 * 判断某状态是否允许**继续采集**（`recording`；`paused` 语义上不采集）。
 *
 * 说明：本函数只回答"状态语义上是否应采集"，与"共享流是否仍连接"无关。
 *
 * @param status 状态。
 * @returns 是否应采集。
 */
export function shouldCapture(status: RecordStatus): boolean {
  return status === 'recording';
}

/**
 * 断言一次状态迁移合法；非法时抛出错误（供开发期/单测做硬校验）。
 *
 * @param from 当前状态。
 * @param to 目标状态。
 * @throws 当迁移非法时抛出 `Error`。
 */
export function assertTransition(from: RecordStatus, to: RecordStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`非法记录状态迁移: ${from} → ${to}`);
  }
}
