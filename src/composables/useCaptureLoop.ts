/**
 * `useCaptureLoop` —— ★ 主采样管线（本任务最核心）。
 *
 * 依据：架构文档 §4.2（单帧采集完整时序图，本文件的实现蓝图）+ §5.2（时间基准）+
 * §5.6（Worker 协议）+ §5.9（等级读取节奏与降级）+ §9.3/§9.4（宽容档 + 多帧投票）。
 *
 * ## 单帧管线（照 §4.2 实现）
 * ```
 * Worker tick 到达
 *   → 若上一帧还没处理完 → 丢弃本帧，直接返回
 *   → 记录帧时间 t = performance.now() - recordStartedAt
 *   → grabRect(regions.expBar) → columnProfile(img, rect, PROFILE_PERCENTILE)
 *   → frameBuffer.push(profile)  // 环形缓冲 FRAME_N=12
 *   → ratioFromProfiles(frameBuffer) → RatioResult{ratio,isFull,confidence}
 *   → expSplit ? grabRect(expText) : 复用同帧 → readDigits(...) → absolute|null
 *   → grabRect(gold) → readDigits(...) → gold|null
 *   → 等级：seq % LEVEL_READ_EVERY_N === 0 或 isExpRatioDiscontinuity 命中
 *            → grabRect(level) → readDigits(...) → level|null
 *   → estimator.observe(...) （在 RecordSession.ingestSample 内）
 *   → confirmGate.mapToReadState(...) → ReadState
 *   → session.ingestSample(sample, t) → IngestResult
 *   → 更新 store（响应式）→ UI 渲染
 * ```
 *
 * ## 可测性设计（关键）
 * 纯逻辑（**丢弃策略 / 等级读取节奏判定 / 环形帧缓冲 / 宽容档触发 / 同框复用判定**）
 * 全部抽成下方**独立导出的纯函数 / 纯类**，浏览器 API 调用（grab、readDigits、store 写入）
 * 通过**依赖注入**传入。因此 Node 下可对本模块的核心决策完整单测。
 */

import { ref, type Ref } from 'vue';
import type { ExpBarProfile, RegionRect, PixelSource, ReadDigitsResult } from '@/types';
import type { ReadState } from '@/types/enums';
import type { CalibrationConfig, RegionKey } from '@/types/calibration';
import { isSameRect } from '@/types/calibration';
import { FRAME_N, LEVEL_READ_EVERY_N, PROFILE_PERCENTILE } from '@/constants';
import {
  NCC_MIN_TOLERANT,
  NCC_MARGIN_TOLERANT,
  TOLERANT_TRIGGER_FRAMES,
  NCC_MIN,
  NCC_MARGIN,
} from '@/constants';
import { columnProfile, ratioFromProfiles, readDigits, TemplateBank } from '@/core/vision';
import { isExpRatioDiscontinuity } from '@/core/metrics';
import {
  RecordSession,
  mapToReadState,
  advanceGateContext,
  type ReadGateContext,
  type ReadSignals,
  type SampleInput,
  type IngestResult,
} from '@/core/record';

// ===========================================================================
// 一、纯逻辑（可单测）
// ===========================================================================

/**
 * 环形帧缓冲：保存最近 `capacity` 帧的列剖面（按时间升序）。
 *
 * 纯类，零浏览器依赖；`push` 后超出容量自动丢弃最旧帧。
 */
export class FrameBuffer {
  /** 容量（`FRAME_N`）。 */
  readonly capacity: number;

  /** 内部数组（时间升序）。 */
  private items: ExpBarProfile[] = [];

  /**
   * @param capacity 容量，默认 `FRAME_N`。
   */
  constructor(capacity: number = FRAME_N) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  /**
   * 追加一帧剖面；超出容量则丢弃最旧帧。
   *
   * @param profile 列剖面。
   * @returns 追加后的长度。
   */
  push(profile: ExpBarProfile): number {
    this.items.push(profile);
    while (this.items.length > this.capacity) this.items.shift();
    return this.items.length;
  }

  /** 当前帧数。 */
  get length(): number {
    return this.items.length;
  }

  /** 判断是否已攒够容量（可做跨帧中值）。 */
  get isFull(): boolean {
    return this.items.length >= this.capacity;
  }

  /**
   * 取内部数组的**只读视图**（时间升序）。
   *
   * @returns 帧列表。
   */
  toArray(): ExpBarProfile[] {
    return this.items;
  }

  /** 清空缓冲。 */
  reset(): void {
    this.items = [];
  }
}

/**
 * 等级读取节奏判定（架构 §5.9 定稿）——**纯函数**。
 *
 * 规则：
 * - 每 `LEVEL_READ_EVERY_N` 帧读一次（`seq % N === 0`）；
 * - **但一旦命中比例不连续下降，立即强制重读，不受 N 帧约束**。
 *
 * @param seq 当前节拍序号（从 0 递增）。
 * @param prevRatio 上一**有效**比例（0–1）；无效传 `null`。
 * @param ratio 当前有效比例（0–1）；无效传 `null`。
 * @param everyN 间隔，默认 `LEVEL_READ_EVERY_N`。
 * @returns `{ shouldRead, forcedByDiscontinuity }`。
 */
export function shouldReadLevel(
  seq: number,
  prevRatio: number | null,
  ratio: number | null,
  everyN: number = LEVEL_READ_EVERY_N,
): { shouldRead: boolean; forcedByDiscontinuity: boolean } {
  const forced = isExpRatioDiscontinuity(prevRatio, ratio);
  const onCadence = everyN > 0 && seq % everyN === 0;
  return { shouldRead: forced || onCadence, forcedByDiscontinuity: forced };
}

/**
 * 宽容档触发判定 + 阈值解析 —— 纯函数。
 *
 * 规则（架构 §9.3/§9.4）：
 * - 仅在**连续 `TOLERANT_TRIGGER_FRAMES` 帧都拒识**时启用宽容档；
 * - 宽容档不提升置信度：命中宽容档的读数标为 `isWeak`（不直接采信）。
 *
 * @param consecutiveReject 连续拒识帧数。
 * @param triggerFrames 触发所需帧数，默认 `TOLERANT_TRIGGER_FRAMES`。
 * @returns `{ tolerant, nccMin, nccMargin }`。
 */
export function resolveTolerantMode(
  consecutiveReject: number,
  triggerFrames: number = TOLERANT_TRIGGER_FRAMES,
): { tolerant: boolean; nccMin: number; nccMargin: number } {
  const tolerant = consecutiveReject >= triggerFrames;
  return tolerant
    ? { tolerant: true, nccMin: NCC_MIN_TOLERANT, nccMargin: NCC_MARGIN_TOLERANT }
    : { tolerant: false, nccMin: NCC_MIN, nccMargin: NCC_MARGIN };
}

/**
 * 判断 `expBar` 与 `expText` 是否可复用同一帧（同矩形且未拆分）。
 *
 * 规则（架构 §3.5.1 约定）：
 * - `expSplit=false` 且两矩形相同 → **只抓一次帧、复用同一份 ImageData**；
 * - `expSplit=true` → 各抓一次。
 *
 * @param calib 校准配置。
 * @returns 是否同框复用。
 */
export function shouldReuseExpFrame(calib: CalibrationConfig): boolean {
  if (calib.expSplit) return false;
  return isSameRect(calib.regions.expBar, calib.regions.expText);
}

/**
 * 判断某区域是否可用于采集（矩形有效）。
 *
 * @param calib 校准配置。
 * @param key 区域键。
 * @returns 是否可用。
 */
export function isRegionActive(calib: CalibrationConfig, key: RegionKey): boolean {
  const r = calib.regions[key];
  return !!r && r.w > 0 && r.h > 0;
}

/**
 * 「上一帧未处理完则丢弃本帧」的门（纯函数）。
 *
 * 语义（架构 §5.6）：主线程收到 tick 后若上一帧仍在处理 → **丢弃本帧，不排队**。
 *
 * @param inFlight 当前是否有帧在处理。
 * @returns 是否应丢弃本帧（`true` = 丢弃）。
 */
export function shouldDropFrame(inFlight: boolean): boolean {
  return inFlight;
}

// ===========================================================================
// 二、单帧处理函数（可注入依赖，便于单测）
// ===========================================================================

/** 单帧处理所需的外部能力（依赖注入，便于单测替换为假实现）。 */
export interface CaptureDeps {
  /** 抓帧：按归一化矩形 → 像素源；失败返回 `null`。 */
  grabRect: (norm: RegionRect) => PixelSource | null;
  /** 字形模板库（当前生效）。 */
  bank: TemplateBank;
  /** 当前校准配置。 */
  calibration: CalibrationConfig;
  /** 记录会话。 */
  session: RecordSession;
  /** 抓帧时刻（ms，相对记录起点）——由调用方传入（`performance.now() - recordStartedAt`）。 */
  now: number;
  /** 当前节拍序号（`seq`）。 */
  seq: number;
}

/** 采集循环的内部可变状态（跨帧持久）。 */
export interface CaptureLoopState {
  /** 环形帧缓冲。 */
  frameBuffer: FrameBuffer;
  /** 上一**有效**比例（0–1）；无则 `null`。 */
  prevRatio: number | null;
  /** 连续拒识帧数。 */
  consecutiveReject: number;
  /** 连续「等级读取都拒识」帧数？此处复用 consecutiveReject 作为整体拒识计数。 */
  gate: ReadGateContext;
}

/**
 * 创建采集循环的初始状态。
 *
 * @returns 初始状态。
 */
export function createCaptureLoopState(): CaptureLoopState {
  return {
    frameBuffer: new FrameBuffer(FRAME_N),
    prevRatio: null,
    consecutiveReject: 0,
    gate: {
      prevState: 'waiting',
      consecutiveMiss: 0,
      confirmingSince: null,
      now: 0,
      awaitingRecovery: false,
    },
  };
}

/** 单帧处理结果（供 UI 更新 + 测试断言）。 */
export interface FrameResult {
  /** 本帧后的读数状态。 */
  readState: ReadState;
  /** 本帧是否更新了关键指标。 */
  changedMetrics: boolean;
  /** 供 UI 的提示 key。 */
  notices: string[];
  /** 本帧比例（0–1）；判不出为 `null`。 */
  ratio: number | null;
  /** 本帧等级；未读/拒识为 `null`。 */
  level: number | null;
  /** 本帧经验绝对值；拒识为 `null`。 */
  absolute: number | null;
  /** 本帧金币；拒识为 `null`。 */
  gold: number | null;
  /** 本帧是否读取了等级区域（供测试断言节奏）。 */
  levelReadThisFrame: boolean;
  /** 本帧是否因不连续而强制重读等级。 */
  levelForcedByDiscontinuity: boolean;
  /** 本帧是否复用了同一帧给 expBar/expText（供测试断言只抓一次）。 */
  reusedExpFrame: boolean;
  /** 本帧抓帧次数（供测试断言只抓一次）。 */
  grabCount: number;
  /** 本帧是否为宽容档。 */
  tolerant: boolean;
  /** 本帧摄取结果。 */
  ingest: IngestResult;
}

/**
 * 处理单帧（**核心纯逻辑路径**，所有浏览器 API 由 `deps` 注入）。
 *
 * 该函数可在 Node 下用假 `grabRect` / 假 `TemplateBank` 完整单测，
 * 覆盖：同框复用、等级节奏、不连续强制重读、宽容档、拒识转发。
 *
 * @param state 采集循环可变状态（**会被就地推进**）。
 * @param deps 注入依赖。
 * @returns 单帧处理结果。
 */
export function processFrame(state: CaptureLoopState, deps: CaptureDeps): FrameResult {
  const { calibration, session, now, seq } = deps;
  let grabCount = 0;

  const expBarActive = isRegionActive(calibration, 'expBar');
  const expTextActive = isRegionActive(calibration, 'expText');

  // ---- 1) 经验条：抓帧 → 列剖面 → 环形缓冲 → 跨帧 2D 中值 ----
  let ratio: number | null = null;
  let ratioConfidence = 0;

  const reuse = shouldReuseExpFrame(calibration);
  let reusedExpFrame = false;
  let expFrame: PixelSource | null = null;

  if (expBarActive) {
    expFrame = deps.grabRect(calibration.regions.expBar);
    grabCount += 1;
    if (expFrame) {
      const profile = columnProfile(expFrame, calibration.regions.expBar, PROFILE_PERCENTILE);
      state.frameBuffer.push(profile);
      const rr = ratioFromProfiles(state.frameBuffer.toArray());
      if (rr.confidence > 0) {
        ratio = rr.ratio;
        ratioConfidence = rr.confidence;
      }
    }
  }

  // ---- 2) 经验数值文字：同框复用 / 各抓一次 ----
  let absolute: number | null = null;
  let textConfidence = 0;
  if (expTextActive) {
    let textFrame: PixelSource | null;
    if (reuse && expBarActive && expFrame) {
      // ★ expBar/expText 同框：复用同一份 ImageData，不再抓帧。
      textFrame = expFrame;
      reusedExpFrame = true;
    } else if (reuse && expBarActive && !expFrame) {
      // 经验条抓帧失败 → 无法复用，退化为单独抓一次文字区。
      textFrame = deps.grabRect(calibration.regions.expText);
      grabCount += 1;
    } else {
      textFrame = deps.grabRect(calibration.regions.expText);
      grabCount += 1;
    }

    if (textFrame) {
      const opts = resolveTolerantMode(state.consecutiveReject);
      const res = readDigits(textFrame, calibration.regions.expText, deps.bank, {
        nccMin: opts.nccMin,
        nccMargin: opts.nccMargin,
      });
      if (res) {
        absolute = res.value;
        textConfidence = res.confidence;
      }
    }
  }

  // ---- 3) 金币 ----
  let gold: number | null = null;
  if (isRegionActive(calibration, 'gold')) {
    const goldFrame = deps.grabRect(calibration.regions.gold);
    grabCount += 1;
    if (goldFrame) {
      const opts = resolveTolerantMode(state.consecutiveReject);
      const res = readDigits(goldFrame, calibration.regions.gold, deps.bank, {
        nccMin: opts.nccMin,
        nccMargin: opts.nccMargin,
      });
      if (res) gold = res.value;
    }
  }

  // ---- 4) 等级：按节奏读取 + 不连续强制重读 ----
  const levelCalibrated = isRegionActive(calibration, 'level');
  const cadence = shouldReadLevel(seq, state.prevRatio, ratio);
  let level: number | null = null;
  const levelReadThisFrame = levelCalibrated && cadence.shouldRead;
  if (levelReadThisFrame) {
    const levelFrame = deps.grabRect(calibration.regions.level);
    grabCount += 1;
    if (levelFrame) {
      const opts = resolveTolerantMode(state.consecutiveReject);
      const res: ReadDigitsResult | null = readDigits(
        levelFrame,
        calibration.regions.level,
        deps.bank,
        { nccMin: opts.nccMin, nccMargin: opts.nccMargin },
      );
      if (res) level = res.value;
    }
  }

  // ---- 5) 拒识计数 / 宽容档 / 弱样本 ----
  const hasAnyReading = (absolute !== null && absolute > 0) || (ratio !== null && ratio > 0);
  if (hasAnyReading) {
    state.consecutiveReject = 0;
  } else {
    state.consecutiveReject += 1;
  }
  const tolerant = resolveTolerantMode(state.consecutiveReject).tolerant;
  const isWeak = tolerant && hasAnyReading;

  // ---- 6) 不连续判定 + prevRatio 缓存（仅缓存**有效**比例） ----
  const discontinuous = isExpRatioDiscontinuity(state.prevRatio, ratio);

  // ---- 7) 读数状态映射（confirmGate） ----
  state.gate.consecutiveMiss = state.consecutiveReject;
  state.gate.now = now;
  const signals: ReadSignals = {
    hasAnyReading,
    isWeak,
    isDiscontinuous: discontinuous,
    // 恢复起点由映射结果判定（见下方 `isRecoveredStart`），此处占位为 false；
    // `mapToReadState` 实际以 `ctx.awaitingRecovery` 为准，不读本字段。
    isRecoveredStart: false,
    levelCalibrated,
    // estimator 的 observe 在 session.ingestSample 内部执行；此处按"有读数即可能被接受"近似。
    // 最终 ReadState 由 session.ingestSample 返回的 readState 覆盖（下方以 ingest 为准）。
    observe: hasAnyReading
      ? {
          accepted: !discontinuous && !isWeak,
          requiredExp: null,
          approximate: true,
          confirming: true,
        }
      : null,
    missingCrossLevel: false,
  };
  const mappedState = mapToReadState(signals, state.gate);
  // ★ 缺陷 1 修复：本帧是否为「中断恢复后的首个已确认帧」。
  //   `confirmGate` 在 `awaitingRecovery && observe.accepted` 时映射为 `recovered`
  //   （瞬时状态，仅出现一次）。这里以映射结果 `mappedState === 'recovered'` 作为
  //   「恢复起点」信号，唯一地驱动 `RecordSession` 开启新连续区间并置
  //   `Segment.isRecoveredStart=true`。这是该信息从采集管线流向记录会话的**唯一**通道，
  //   避免把 `awaitingRecovery`（gate 内部上下文）散落到 `RecordSession`。
  const isRecoveredStart = mappedState === 'recovered';
  const gateAdvance = advanceGateContext(mappedState, state.gate);
  state.gate.prevState = gateAdvance.prevState;
  state.gate.confirmingSince = gateAdvance.confirmingSince;
  state.gate.awaitingRecovery = gateAdvance.awaitingRecovery;

  // ---- 8) 摄取采样点 ----
  const confidence = Math.max(ratioConfidence, textConfidence);
  const input: SampleInput = {
    t: now,
    expRaw: absolute,
    expPct: ratio,
    level,
    gold,
    hp: null,
    mp: null,
    confidence,
    readState: mappedState,
    isWeak,
    isDiscontinuous: discontinuous,
    isRecoveredStart,
    levelCalibrated,
  };
  const ingest = session.ingestSample(input);

  // 以 session 最终状态为准（session 可能因升级/换角色改写为 interrupted 等）。
  const finalState = ingest.readState;

  // ---- 9) 缓存上一有效比例（仅当本帧比例有效） ----
  if (ratio !== null) {
    state.prevRatio = ratio;
  }

  return {
    readState: finalState,
    changedMetrics: ingest.changedMetrics,
    notices: ingest.notices,
    ratio,
    level,
    absolute,
    gold,
    levelReadThisFrame,
    levelForcedByDiscontinuity: cadence.forcedByDiscontinuity,
    reusedExpFrame,
    grabCount,
    tolerant,
    ingest,
  };
}

// ===========================================================================
// 三、浏览器侧组合式封装（薄封装）
// ===========================================================================

/** `useCaptureLoop` 的入参。 */
export interface UseCaptureLoopOptions {
  /** 抓帧器（来自 `useFrameGrabber`）。 */
  grabber: () => {
    grabRect: (norm: RegionRect) => PixelSource | null;
    readonly ready: boolean;
  };
  /** 当前校准配置（响应式读取）。 */
  calibration: () => CalibrationConfig | null;
  /** 当前生效模板库（响应式读取）。 */
  bank: () => TemplateBank | null;
  /** 会话提供者：返回当前 `RecordSession`；未记录返回 `null`。 */
  session: () => RecordSession | null;
  /** 记录起点（`performance.now()` 口径）；未记录返回 `null`。 */
  recordStartedAt: () => number | null;
  /** 帧结果回调（用于更新 store / UI）。 */
  onFrame?: (result: FrameResult) => void;
  /** 是否启用宽容档的 UI 提示（默认 `true`）。 */
  enableTolerantNotice?: boolean;
}

/** `useCaptureLoop` 的返回。 */
export interface UseCaptureLoop {
  /** 是否正在处理一帧（`inFlight`；用于「未处理完则丢弃」）。 */
  inFlight: Ref<boolean>;
  /** 累计处理帧数。 */
  processedFrames: Ref<number>;
  /** 累计丢弃帧数（tick 到达时上一帧未完成）。 */
  droppedFrames: Ref<number>;
  /** 最近一帧结果。 */
  lastResult: Ref<FrameResult | null>;
  /** 处理一次 tick（由 Worker 的 tick 消息驱动）。 */
  onTick: (tickSeq: number) => void;
  /** 重置循环状态（新记录开始时调用）。 */
  reset: () => void;
}

/**
 * 创建主采样循环（需在组件作用域内调用；纯逻辑在 `processFrame`）。
 *
 * @param opts 依赖与回调。
 * @returns `UseCaptureLoop`。
 */
export function useCaptureLoop(opts: UseCaptureLoopOptions): UseCaptureLoop {
  const inFlight = ref(false);
  const processedFrames = ref(0);
  const droppedFrames = ref(0);
  const lastResult = ref<FrameResult | null>(null);

  let state = createCaptureLoopState();

  /** 处理一次 tick：未完成则丢弃；否则同步走完单帧管线。 */
  const onTick = (tickSeq: number): void => {
    // 未处理完 → 丢弃本帧（不排队）。
    if (shouldDropFrame(inFlight.value)) {
      droppedFrames.value += 1;
      return;
    }
    const gr = opts.grabber();
    if (!gr.ready) return;

    const calib = opts.calibration();
    const bank = opts.bank();
    const session = opts.session();
    const startedAt = opts.recordStartedAt();
    if (!calib || !bank || !session || startedAt === null) return;

    inFlight.value = true;
    try {
      const now = typeof performance !== 'undefined' ? performance.now() - startedAt : 0;
      const result = processFrame(state, {
        grabRect: gr.grabRect,
        bank,
        calibration: calib,
        session,
        now,
        seq: tickSeq,
      });
      processedFrames.value += 1;
      lastResult.value = result;
      opts.onFrame?.(result);
    } finally {
      inFlight.value = false;
    }
  };

  /** 重置循环状态。 */
  const reset = (): void => {
    state = createCaptureLoopState();
    processedFrames.value = 0;
    droppedFrames.value = 0;
    lastResult.value = null;
    inFlight.value = false;
  };

  return { inFlight, processedFrames, droppedFrames, lastResult, onTick, reset };
}
