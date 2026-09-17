/**
 * 速率对比：「近 60 秒 vs 全程平均」+ 4%/2%/1.5s hysteresis —— 纯函数。
 *
 * 规则（PRD P0-7 / 预研 §4.5）：
 * - 偏差 `|近60秒速率 − 全程平均| / 全程平均 ≥ 4%` → 显示箭头（升/降）；
 * - 偏差回落到 `≤ 2%` → 启动 1.5s 计时器，到时仍 `≤ 2%` 才隐藏箭头；
 * - 「近 60 秒」窗口用真实时间戳（`RATE_WINDOW_MS`），**不用帧数**。
 *
 * ## 两个速率的定义（关键设计说明）
 *
 * 预研 §4.5 的公式是 `偏差 = |近60秒速率 − 全程平均| / 全程平均`，二者必须**真正独立**：
 * - **`last60s`（近 60 秒速率）**：窗口 `[now − RATE_WINDOW_MS, now]` 内样本的**时间加权均值**，
 *   反应敏捷（能立刻体现"最近变快/变慢"）。
 * - **`overallAvg`（全程平均）**：**会话累积的时间加权均值**，用**缓变（EMA）**方式累积。
 *   若简单取"窗口内样本均值"，则当会话时长 < 60s 时两个统计量恒等、偏差恒为 0，
 *   箭头永远无法触发（这正是"近 60 秒 vs 全程平均"必须区分快/慢两个时间尺度才能工作的原因）。
 *
 * EMA 以**真实时间**为尺度：`α = 1 − exp(−Δt / τ)`，`τ = RATE_EMA_TAU_MS`（远大于 60s 窗口），
 * 因此 `overallAvg` 等价于"整个会话的平均"，且不随窗口滑动而突变。
 *
 * 状态推进设计为**纯函数**：输入 `prev + now` 输出 `next`，便于单测（含假时钟）。
 */

import {
  RATE_ARROW,
  RATE_EMA_TAU_MS,
  RATE_HIDE,
  RATE_HIDE_DELAY_MS,
  RATE_WINDOW_MS,
} from '@/constants';

/** 速率采样点。 */
export interface RateSample {
  /** 时刻（ms，记录内相对时间）。 */
  t: number;
  /** 该时刻的瞬时速率（经验/小时）。 */
  expPerHour: number;
}

/** 速率对比快照（纯数据，可被 UI 直接渲染）。 */
export interface RateComparisonSnapshot {
  /** 近 60 秒速率；样本不足为 `null`。 */
  last60s: number | null;
  /** 全程平均速率；样本不足为 `null`。 */
  overallAvg: number | null;
  /** 相对偏差（`(last60s − overallAvg) / overallAvg`）；不可算时为 0。 */
  diffRatio: number;
  /** 箭头是否可见。 */
  arrowVisible: boolean;
  /** 箭头方向：`true` = 上升（当前高于平均）。 */
  arrowUp: boolean;
}

/** 内部状态（含 hysteresis 计时）。 */
export interface RateComparisonState extends RateComparisonSnapshot {
  /** 采样点环形缓冲（按时间升序，仅保留窗口附近）。 */
  samples: RateSample[];
  /** 待隐藏时刻（ms）；`null` 表示无待隐藏计时。 */
  pendingHideAt: number | null;
  /** 上一次推入样本的时刻（ms）；`null` 表示尚未有样本。 */
  lastSampleAt: number | null;
  /** `overallAvg` 的时间加权 EMA 累加器；`null` 表示尚无值。 */
  overallEma: number | null;
}

/**
 * 创建初始速率对比状态。
 *
 * @returns 初始 `RateComparisonState`。
 */
export function createRateComparison(): RateComparisonState {
  return {
    last60s: null,
    overallAvg: null,
    diffRatio: 0,
    arrowVisible: false,
    arrowUp: false,
    samples: [],
    pendingHideAt: null,
    lastSampleAt: null,
    overallEma: null,
  };
}

/**
 * 推进一步（纯函数）：喂入一个新速率采样点，返回**新的**状态。
 *
 * 说明：不修改 `prev`，返回新对象（`prev + now → next` 语义），便于测试与响应式集成。
 *
 * `last60s` = 窗口内样本的时间加权均值；`overallAvg` = 全会话 EMA（时间常数
 * `RATE_EMA_TAU_MS`）。二者时间尺度独立，从而 `偏差` 能真正反映"最近变快/变慢"。
 *
 * @param prev 上一状态。
 * @param now 当前时刻（ms）。
 * @param currentExpPerHour 当前瞬时速率（经验/小时）；`null` 表示本帧无有效速率（跳过）。
 * @param windowMs 「近 N 秒」窗口，默认 `RATE_WINDOW_MS`。
 * @returns 新状态。
 */
export function pushRateSample(
  prev: RateComparisonState,
  now: number,
  currentExpPerHour: number | null,
  windowMs: number = RATE_WINDOW_MS,
): RateComparisonState {
  if (!Number.isFinite(now)) return cloneState(prev);

  const hasSample = currentExpPerHour !== null && Number.isFinite(currentExpPerHour);

  const samples = hasSample
    ? [...prev.samples, { t: now, expPerHour: currentExpPerHour as number }]
    : prev.samples.slice();

  // 只保留窗口内的样本（`last60s` 用）。
  const cutoff = now - windowMs;
  const windowed = samples.filter((s) => s.t >= cutoff);

  // 近 N 秒速率 = 窗口内样本的**时间加权**均值。
  const last60s = weightedMean(windowed);

  // 全程平均 = 会话累积 EMA（时间加权）。首帧直接初始化，后续按真实 Δt 收敛。
  let overallEma = prev.overallEma;
  let lastSampleAt = prev.lastSampleAt;
  if (hasSample) {
    if (overallEma === null) {
      overallEma = currentExpPerHour as number;
    } else {
      const dt = lastSampleAt === null ? 0 : Math.max(0, now - lastSampleAt);
      const alpha = 1 - Math.exp(-dt / RATE_EMA_TAU_MS);
      overallEma = overallEma + alpha * ((currentExpPerHour as number) - overallEma);
    }
    lastSampleAt = now;
  }
  const overallAvg = overallEma;

  let diffRatio = 0;
  if (last60s !== null && overallAvg !== null && overallAvg !== 0) {
    diffRatio = (last60s - overallAvg) / overallAvg;
  }

  const absDiff = Math.abs(diffRatio);
  let arrowVisible = prev.arrowVisible;
  let arrowUp = prev.arrowUp;
  let pendingHideAt = prev.pendingHideAt;

  if (last60s === null || overallAvg === null) {
    // 样本不足 → 不显示、清除计时。
    arrowVisible = false;
    pendingHideAt = null;
  } else if (absDiff >= RATE_ARROW) {
    // 偏差达 4% → 立即显示，清除待隐藏计时。
    arrowVisible = true;
    arrowUp = diffRatio > 0;
    pendingHideAt = null;
  } else if (absDiff <= RATE_HIDE) {
    // 偏差回落到 2% 以内 → 如果箭头正显示，启动 1.5s 延迟隐藏。
    if (arrowVisible) {
      if (pendingHideAt === null) {
        pendingHideAt = now + RATE_HIDE_DELAY_MS;
      } else if (now >= pendingHideAt) {
        arrowVisible = false;
        pendingHideAt = null;
      }
    } else {
      pendingHideAt = null;
    }
  }
  // 位于 (2%, 4%) 的"死区" → 保持现状（不显示新的、也不隐藏已有的）。

  return {
    last60s,
    overallAvg,
    diffRatio,
    arrowVisible,
    arrowUp,
    samples,
    pendingHideAt,
    lastSampleAt,
    overallEma,
  };
}

/**
 * 时间加权均值：权重为「该样本到下一（更晚）样本的时长」；最后一个样本沿用前一段时长。
 *
 * 说明：所有样本等间隔时退化为算术平均（与预研/单测的期望一致）。
 *
 * @param samples 按时间升序的样本。
 * @returns 时间加权均值；空数组返回 `null`。
 */
function weightedMean(samples: RateSample[]): number | null {
  const n = samples.length;
  if (n === 0) return null;
  if (n === 1) return samples[0].expPerHour;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    // 权重 = 到"下一个"样本的间隔；最后一个样本沿用前一个间隔。
    const dt = i < n - 1 ? samples[i + 1].t - samples[i].t : samples[i].t - samples[i - 1].t;
    const w = dt > 0 ? dt : 1;
    num += samples[i].expPerHour * w;
    den += w;
  }
  return den > 0 ? num / den : samples[n - 1].expPerHour;
}

/**
 * 计算数组均值。
 *
 * @param values 数值数组。
 * @returns 均值；空数组返回 `null`。
 */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * 拷贝状态（不复制采样数组，避免不必要的开销；仅用于"无推进"分支）。
 *
 * @param s 状态。
 * @returns 新状态对象。
 */
function cloneState(s: RateComparisonState): RateComparisonState {
  return {
    last60s: s.last60s,
    overallAvg: s.overallAvg,
    diffRatio: s.diffRatio,
    arrowVisible: s.arrowVisible,
    arrowUp: s.arrowUp,
    samples: s.samples,
    pendingHideAt: s.pendingHideAt,
    lastSampleAt: s.lastSampleAt,
    overallEma: s.overallEma,
  };
}
