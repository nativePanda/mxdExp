/**
 * 读数确认门（confirmGate）—— 把「本帧识别/交叉校验结果」映射为 `ReadState`。
 *
 * 依据：架构文档 §3.3（`ReadState` 9 值）+ §4.2（单帧时序）+ §5.9（降级路径）+
 * §9.3/§9.4（宽容档 + 多帧投票）。
 *
 * 纯函数，零 DOM / 零 Vue 依赖；**不持有状态**，由调用方（采集循环）维护
 * 「上一状态 / 连续拒识计数」等上下文并传入。这样本模块可在 Node 下单测。
 *
 * ## 9 个 `ReadState` 的语义与流转（PRD §6.4 / 架构 §5.3）
 *
 * | 值 | 含义 | 进入条件 |
 * |----|------|---------|
 * | `waiting`         | 等待读数 | 尚未取得任何有效读数（前若干帧） |
 * | `accumulating`    | 积累样本 | 已有有效读数，但 estimator 仍在累积（正常推进、未收敛） |
 * | `confirming`      | 确认中   | 交叉校验未通过 / 弱样本 / 比例不连续等，需后续帧确认 |
 * | `confirmed`       | 上次确认 | 本帧被 estimator 接受，且各项一致 |
 * | `missingCrossLevel` | 跨级经验缺失 | 升级瞬间比例归零/跨级，区间无法直接换算 |
 * | `timeout`         | 确认超时 | 处于 `confirming` 超过 `CONFIRM_TIMEOUT_MS` 仍未确认 |
 * | `interrupted`     | 连续性中断 | 连续拒识达 `INTERRUPT_AFTER_FRAMES` 帧（遮挡/暂停/掉线） |
 * | `unconfirmedNet`  | 存在未确认区间 | 记录结束时仍有未确认区间（由 `RecordSession.finish` 置位） |
 * | `recovered`       | 恢复后区间 | 中断恢复后的第一段（效率只统计恢复后连续区间） |
 *
 * ## 映射优先级（从高到低）
 *
 * 1. `unconfirmedNet`（终局态，由 finish 直接设定，采集期不产生）；
 * 2. `interrupted`（连续拒识超阈值）—— 最高运行时优先级；
 * 3. `timeout`（`confirming` 持续超时）；
 * 4. `missingCrossLevel`（预估器/读数显式报告跨级）；
 * 5. `recovered`（本帧为中断恢复后的首帧且已确认）；
 * 6. `confirmed`（本帧被接受且一致）；
 * 7. `confirming`（弱样本 / 不连续 / 未收敛 / 估算值）；
 * 8. `accumulating`（已有有效读数但样本不足）；
 * 9. `waiting`（本帧完全无有效读数，但未达中断阈值）。
 */

import type { ReadState } from '@/types/enums';
import type { ObserveResult } from '@/core/estimator';
import { CONFIRM_TIMEOUT_MS, INTERRUPT_AFTER_FRAMES } from '@/constants';

// ---------------------------------------------------------------------------
// 输入 / 输出
// ---------------------------------------------------------------------------

/** 一帧读数信号（识别 + 交叉校验结果），供 `mapToReadState` 决策。 */
export interface ReadSignals {
  /** 本帧是否有**任一**可用读数（文字或比例任一有效）。 */
  hasAnyReading: boolean;
  /** 本帧是否为「弱样本」（如宽容档命中、置信度偏低）。 */
  isWeak: boolean;
  /** 本帧是否命中经验条比例不连续下降（升级/换角色/断线信号）。 */
  isDiscontinuous: boolean;
  /** 本帧是否为中断恢复后的首帧（`recovered` 判定用）。 */
  isRecoveredStart: boolean;
  /** 等级是否已校准（未校准时降级路径：不严格交叉校验，改直接 `confirming`）。 */
  levelCalibrated: boolean;
  /** estimator 的观测结果；无有效读数时传 `null`。 */
  observe: ObserveResult | null;
  /** 预估器/读数是否显式报告「跨级经验缺失」。 */
  missingCrossLevel: boolean;
}

/** `mapToReadState` 的上下文（由采集循环维护）。 */
export interface ReadGateContext {
  /** 上一帧的 `ReadState`。 */
  prevState: ReadState;
  /** 连续拒识帧数（含本帧，调用方在调用前累加）。 */
  consecutiveMiss: number;
  /** 当前处于 `confirming` 的起始时刻（ms）；不在 `confirming` 时为 `null`。 */
  confirmingSince: number | null;
  /** 当前时刻（ms，相对记录起点）。 */
  now: number;
  /** 中断恢复后是否尚未产出首个确认帧（`recovered` 判定用）。 */
  awaitingRecovery?: boolean;
}

/**
 * 把一帧读数信号映射为 `ReadState`。
 *
 * @param signals 本帧读数信号。
 * @param ctx 决策上下文。
 * @returns 本帧应处于的 `ReadState`。
 */
export function mapToReadState(signals: ReadSignals, ctx: ReadGateContext): ReadState {
  const { prevState, consecutiveMiss, confirmingSince, now } = ctx;

  // (2) 连续拒识超阈值 → interrupted（最高运行时优先级）。
  if (consecutiveMiss >= INTERRUPT_AFTER_FRAMES) {
    return 'interrupted';
  }

  // (3) 已处于 confirming 且超时 → timeout。
  if (prevState === 'confirming' && confirmingSince !== null) {
    if (now - confirmingSince >= CONFIRM_TIMEOUT_MS) {
      return 'timeout';
    }
  }

  // (4) 显式报告跨级经验缺失 → missingCrossLevel。
  if (signals.missingCrossLevel) {
    return 'missingCrossLevel';
  }

  // 本帧完全没有有效读数（但未达中断阈值）：沿用上一次"非中断"状态；
  // 若此前从未有过有效读数，则保持 waiting。
  if (!signals.hasAnyReading) {
    if (prevState === 'waiting' || prevState === 'unconfirmedNet') return 'waiting';
    if (prevState === 'interrupted' || prevState === 'timeout') {
      // 中断/超时后仍未恢复有效读数 → 继续等待（由调用方在恢复时切 recovered）。
      return prevState;
    }
    // 之前有有效读数，仅本帧丢失 → 沿用上次确认语义（不跳变）。
    return prevState === 'accumulating' ? 'accumulating' : 'confirming';
  }

  const observe = signals.observe;

  // 无观测结果（如等级非法导致 observe 短路）→ 视为弱样本处理。
  if (!observe) {
    return 'confirming';
  }

  // (5) 中断恢复后的首个**已确认**帧 → recovered。
  if (ctx.awaitingRecovery && observe.accepted) {
    return 'recovered';
  }

  // (6) 本帧被接受。
  if (observe.accepted) {
    // 命中比例不连续（疑似升级/换角色）：在**等级未校准**时降级为纯数值判定，
    // 不做严格交叉校验，先进 confirming 由后续帧确认（架构 §5.9 降级路径 3）。
    if (signals.isDiscontinuous && !signals.levelCalibrated) {
      return 'confirming';
    }
    // 弱样本即便 accepted 也先进 confirming（不直接采信，架构 §9.4）。
    if (signals.isWeak) {
      return 'confirming';
    }
    return 'confirmed';
  }

  // (7) 未被接受（`confirming: true`）→ confirming。
  if (observe.confirming) {
    return 'confirming';
  }

  // 未被接受且不在确认中：
  // - 若命中不连续（升级信号）→ 视为需确认的关键时刻 → confirming；
  // - 否则若是"绝对值回退/不一致"类拒绝 → confirming（沿用上次确认值，UI 不跳变）；
  // - 否则（有有效读数但无法推进）→ accumulating 继续积累。
  if (signals.isDiscontinuous) {
    return 'confirming';
  }
  return 'accumulating';
}

/**
 * 计算下一次调用 `mapToReadState` 所需的新上下文片段。
 *
 * 说明：把"上下文如何随状态推进"也收敛为纯函数，避免采集循环里散落状态逻辑，
 * 便于单测整条 `ReadState` 流转链。
 *
 * @param next 本帧映射得到的状态。
 * @param ctx 当前上下文。
 * @returns 更新后的上下文（`prevState` / `confirmingSince` / `awaitingRecovery`）。
 */
export function advanceGateContext(
  next: ReadState,
  ctx: ReadGateContext,
): Pick<ReadGateContext, 'prevState' | 'confirmingSince' | 'awaitingRecovery'> {
  // 进入 confirming：若此前不在 confirming，则记录起始时刻。
  const enteringConfirming = next === 'confirming' && ctx.prevState !== 'confirming';
  const confirmingSince = next === 'confirming'
    ? (enteringConfirming ? ctx.now : ctx.confirmingSince)
    : null;

  // awaitingRecovery：中断/超时后为 true；一旦产出 confirmed/recovered 即清除。
  let awaitingRecovery = ctx.awaitingRecovery ?? false;
  if (next === 'interrupted' || next === 'timeout') {
    awaitingRecovery = true;
  } else if (next === 'confirmed' || next === 'recovered') {
    awaitingRecovery = false;
  }

  return { prevState: next, confirmingSince, awaitingRecovery };
}

/**
 * 判断某 `ReadState` 是否表示"当前指标数值可信（可更新 UI 数值）"。
 *
 * 语义：`confirmed` / `recovered` 为可信；其余（`confirming` / `timeout` /
 * `interrupted` / `waiting` / `accumulating` / `missingCrossLevel`）应沿用上次确认值
 * （架构 §4.2：拒识/不一致时「沿用上次确认值」，UI 数值不跳变）。
 *
 * @param state 读数状态。
 * @returns 是否可信。
 */
export function isTrustedState(state: ReadState): boolean {
  return state === 'confirmed' || state === 'recovered';
}
