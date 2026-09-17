/**
 * 记录会话核心（`RecordSession`）。
 *
 * 依据：架构文档 §3.3（类图 + 关键签名）、§4.2（单帧时序）、§4.3（结束→保存）、
 * §5.2（时间基准）、§5.4（拒识约定）、§5.9（等级节奏与降级）。
 *
 * 纯 TypeScript，零 DOM / 零 Vue 依赖（持有 `ExpRequirementEstimator` 与 `RateComparison`
 * 两个纯逻辑对象，以及纯数据数组）。可在 Node 下单测。
 *
 * ## 硬约定
 * - 时间基准：所有 `t` = `performance.now() - recordStartedAt`（ms，相对记录起点），
 *   由调用方传入；本类**不读时钟**（便于单测注入 `now`）。
 * - `Record.createdAt/endedAt` 用 `Date.now()`（绝对时间）—— 由 `createdAtMs` 传入。
 * - 「经验/小时」一律用真实时间跨度 `deltaExp/deltaMs`（`core/metrics.expPerHour`）。
 * - 拒识：`Sample` 字段存 `null`，`netExp` 有未确认区间置 `null`。
 * - 采样点**记录中攒内存**，`finish` 时由调用方取 `pendingSamples` 批量落库（§5.8）。
 */

import type {
  LevelUpEvent,
  LevelInfo,
  Record as MapleRecord,
  Sample,
  Segment,
} from '@/types/models';
import type { ReadState, RecordStatus } from '@/types/enums';
import type { ExpReading } from '@/types/vision';
import type { RegionKey } from '@/types/calibration';
import { createDefaultClientInfo } from '@/types/models';
import type { ClientInfo } from '@/types/models';
import {
  createRateComparison,
  pushRateSample,
  expPerHour as computeExpPerHour,
  goldPerHour as computeGoldPerHour,
  efficiencyTier,
  levelProgress,
  summarizeSegments,
  type RateComparisonState,
  type RateComparisonSnapshot,
} from '@/core/metrics';
import {
  ExpRequirementEstimator,
  type ObserveOptions,
  type ObserveResult,
} from '@/core/estimator';
import { uuid } from '@/utils/uuid';
import { SCHEMA_VERSION } from '@/types/models';
import { canTransition, nextStatus, shouldCapture } from './recordMachine';

// ---------------------------------------------------------------------------
// 公开类型
// ---------------------------------------------------------------------------

/** `RecordSession.ingestSample` 的入参（一帧采集结果）。 */
export interface SampleInput {
  /** 该帧时间（ms，相对记录起点）。 */
  t: number;
  /** 经验文字读数；拒识为 `null`。 */
  expRaw: number | null;
  /** 经验条比例 0–1；拒识为 `null`。 */
  expPct: number | null;
  /** 当前等级；拒识/未校准为 `null`。 */
  level: number | null;
  /** 金币；拒识为 `null`。 */
  gold: number | null;
  /** HP（P1）；拒识为 `null`。 */
  hp: number | null;
  /** MP（P1）；拒识为 `null`。 */
  mp: number | null;
  /** 该帧整体置信度 0–1。 */
  confidence: number;
  /** 该帧的读数确认状态（由 `confirmGate` 判定）。 */
  readState: ReadState;
  /** 是否为「弱样本」（宽容档/低置信度，不直接采信）。 */
  isWeak?: boolean;
  /** 是否命中经验条比例不连续下降（升级/换角色/断线信号）。 */
  isDiscontinuous?: boolean;
  /** 是否为中断恢复后的首帧。 */
  isRecoveredStart?: boolean;
  /** 等级区域是否已校准（未校准时降级：不严格交叉校验）。 */
  levelCalibrated?: boolean;
}

/** `ingestSample` 的返回。 */
export interface IngestResult {
  /** 本帧后的读数状态。 */
  readState: ReadState;
  /** 本次是否改变了关键指标（`netExp`/`expPerHour`/等级等）。 */
  changedMetrics: boolean;
  /** 供 UI 显示的异常文案 key 列表。 */
  notices: string[];
}

/** `RecordSession` 构造参数。 */
export interface RecordSessionOptions {
  /** 会话 id；默认自动生成 UUID。 */
  id?: string;
  /** 记录开始时刻（`Date.now()`）；默认 `Date.now()`。 */
  createdAtMs?: number;
  /** 等级区域是否已校准（未校准时升级检测降级，§5.9）。 */
  levelCalibrated?: boolean;
  /** 客户端环境快照（分辨率/UA/校准版本）。 */
  clientInfo?: ClientInfo;
  /**
   * 记录起始等级（若已由 UI/校准得知）。
   * 缺省时由首个有效等级读数推断；仍未知则为 `0`（由 `finish` 兜底）。
   */
  levelStart?: number;
}

/** 记录会话的实时快照（供 UI 响应式渲染，纯数据）。 */
export interface SessionSnapshot {
  /** 记录状态。 */
  status: RecordStatus;
  /** 读数确认状态。 */
  readState: ReadState;
  /** 当前等级进度信息。 */
  levelInfo: LevelInfo | null;
  /** 速率对比快照。 */
  rate: RateComparisonSnapshot;
  /** 已记录的真实时长（ms，不含暂停）。 */
  durationMs: number;
  /** 净经验；存在未确认区间为 `null`。 */
  netExp: number | null;
  /** 经验/小时；不可算为 `null`。 */
  expPerHour: number | null;
  /** 金币/小时；不可算为 `null`。 */
  goldPerHour: number | null;
  /** 最近一次采样点（供 UI 显示"数据更新时间"）。 */
  lastSample: Sample | null;
  /** 是否等级未校准（降级标注用）。 */
  levelCalibrated: boolean;
}

// ---------------------------------------------------------------------------
// RecordSession
// ---------------------------------------------------------------------------

/**
 * 一次记录会话。
 *
 * 生命周期：`start → (pause ↔ resume)* → finish`。
 * 结束时 `finish(now)` 汇总出 `Record`，并把采样点留在 `pendingSamples` 供批量落库。
 */
export class RecordSession {
  /** 会话 id。 */
  readonly id: string;

  /** 记录开始绝对时刻（`Date.now()`）。 */
  readonly createdAt: number;

  /** 结果对象的 id 别名（与 `id` 相同，便于与类图字段名对齐）。 */
  get startedAt(): number {
    return this.createdAt;
  }

  /** 当前记录状态。 */
  status: RecordStatus = 'idle';

  /** 开始等级（未知时为 `0`，由首个等级读数或 `finish` 兜底）。 */
  levelStart = 0;

  /** 结束等级（未知时为 `0`）。 */
  levelEnd = 0;

  /** 净经验；含未确认区间为 `null`。 */
  netExp: number | null = null;

  /** 经验/小时。 */
  expPerHour: number | null = null;

  /** 金币/小时。 */
  goldPerHour: number | null = null;

  /** 连续有效统计区间列表。 */
  segments: Segment[] = [];

  /** 升级事件列表。 */
  levelUps: LevelUpEvent[] = [];

  /** 读数确认状态。 */
  readState: ReadState = 'waiting';

  /** 自举经验表估算器（纯逻辑）。 */
  private readonly estimator: ExpRequirementEstimator = new ExpRequirementEstimator();

  /** 速率对比状态（纯逻辑，纯函数推进）。 */
  private rateCompare: RateComparisonState = createRateComparison();

  /** 当前活动区间的起点（ms）；无活动区间为 `null`。 */
  private activeSegmentStart: number | null = null;

  /** 记录中累计的采样点（记录结束批量落库）。 */
  private samples: Sample[] = [];

  /** 等级区域是否已校准。 */
  private levelCalibrated: boolean;

  /** 客户端环境快照。 */
  private readonly clientInfo: ClientInfo;

  /**
   * 最近一次**处理过**的帧时刻（ms）。逐帧推进，与读数有效性解耦；
   * 用于快照的「当前时刻」参考与活动区间末端。**不**承担时长累加职责。
   */
  private lastT: number | null = null;

  /**
   * 最近一次**有有效读数**的帧时刻（ms）。仅在有有效读数的帧上推进；
   * `accumulatedMs` 只累加相邻两个有效读数帧之间的跨度（`durationMs` 语义为
   * 「有效记录时长」，不含暂停与无数据墙钟时间）。
   *
   * 关键设计：`start`/`resume` 时把本字段锚定到**区段起点**（而非 `null`），
   * 这样「记录开始 → 首个有效读数帧」这段**连续有效**的跨度被计入；一旦出现
   * 无有效读数的帧（遮挡/拒识），立即置 `null`，从而「无数据的墙钟时间」——
   * 无论发生在区段**开头**还是中间——都不会被计入（首个恢复帧仅重建基准）。
   */
  private lastValidT: number | null = null;

  /** 累计的**有效**记录时长（ms，不含暂停；按真实时间跨度累加）。 */
  private accumulatedMs = 0;

  /** 暂停前最后一次推进的时间（ms，相对记录起点）。 */
  private pauseMarkT: number | null = null;

  /** 起始经验绝对值（首个有效文字读数）。 */
  private startExpAbs: number | null = null;

  /** 最近一次有效经验绝对值（本级内）。 */
  private lastExpAbs: number | null = null;

  /** 最近一次有效经验比例（0–1）。 */
  private lastRatio: number | null = null;

  /** 起始金币（首个有效金币读数）。 */
  private goldStart: number | null = null;

  /** 最近一次有效金币读数。 */
  private lastGold: number | null = null;

  /** 最近一次有效等级。 */
  private lastLevel: number | null = null;

  /** 最近一次采样点（快照用）。 */
  private lastSample: Sample | null = null;

  /** 是否存在未确认区间（用于 `finish` 决定 `netExp`）。 */
  private hasUnconfirmed = false;

  /** 等级未校准降级时是否给出过提示（去重，避免 notices 泛滥）。 */
  private levelDegradeNotified = false;

  /** 是否为中断恢复后尚未产出确认帧（`recovered` 判定）。 */
  private awaitingRecovery = false;

  /**
   * 构造一个记录会话（**不自动开始**；调用 `start(now)` 进入 `recording`）。
   *
   * @param opts 可选参数。
   */
  constructor(opts: RecordSessionOptions = {}) {
    this.id = opts.id ?? uuid();
    this.createdAt = opts.createdAtMs ?? Date.now();
    this.levelCalibrated = opts.levelCalibrated ?? false;
    this.clientInfo = opts.clientInfo ?? createDefaultClientInfo();
    this.levelStart = opts.levelStart ?? 0;
    this.levelEnd = this.levelStart;
  }

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  /**
   * 开始记录（`idle → recording`）。
   *
   * @param now 当前时刻（ms，相对记录起点）。
   * @returns 是否成功开始（非法状态返回 `false`）。
   */
  start(now: number): boolean {
    if (!canTransition(this.status, 'recording')) return false;
    this.status = nextStatus(this.status, 'recording');
    // 开启首个连续区间（非恢复起点）。
    this.openSegment(now, false);
    this.lastT = now;
    // 新会话：有效读数基准锚定到区段起点（首个有效帧据此计入从起点起的跨度；
    // 若首个有效帧之前出现无读数帧，则该基准会被重置为 null，见 ingestSample）。
    this.lastValidT = now;
    this.pauseMarkT = null;
    this.rateCompare = createRateComparison();
    this.estimator.reset();
    return true;
  }

  /**
   * 暂停记录（`recording → paused`）。
   *
   * 语义（架构 A1）：暂停期间**停止采样**，但保留共享流；关闭当前区间，
   * 暂停时长不计入有效时长。
   *
   * @param now 当前时刻（ms）。
   * @returns 是否成功暂停。
   */
  pause(now: number): boolean {
    if (!canTransition(this.status, 'paused')) return false;
    // 暂停前把「上次采样 → 暂停时刻」这段真实时间也计入有效时长。
    this.advanceTimeTo(now);
    this.status = nextStatus(this.status, 'paused');
    this.closeActiveSegment(now);
    this.pauseMarkT = now;
    return true;
  }

  /**
   * 继续记录（`paused → recording`）。
   *
   * 恢复后开启**新的区间**并标记 `isRecoveredStart=true`（对应 `ReadState='recovered'`）。
   *
   * @param now 当前时刻（ms）。
   * @returns 是否成功继续。
   */
  resume(now: number): boolean {
    if (!canTransition(this.status, 'recording')) return false;
    this.status = nextStatus(this.status, 'recording');
    // 恢复起点：开启新区间（暂停后的恢复同样标记恢复起点，与中断恢复语义一致）。
    this.openSegment(now, true);
    this.lastT = now;
    // 恢复后有效读数基准锚定到恢复起点（连续有效则计入；若恢复后立即出现无读数帧，
    // 基准被重置为 null，跨暂停/遮挡的间隙不计入时长）。
    this.lastValidT = now;
    this.pauseMarkT = null;
    this.awaitingRecovery = true;
    return true;
  }

  /**
   * 结束记录并汇总出 `Record`（`* → finishing → saving → ended`）。
   *
   * - 关闭当前活动区间；存在未确认区间 → `netExp=null`、`readState='unconfirmedNet'`；
   * - 汇总 `netExp / expPerHour / goldPerHour / efficiencyTier`；
   * - 采样点保留在 `pendingSamples`，由调用方批量落库（§5.8）。
   *
   * @param now 当前时刻（ms，相对记录起点）。
   * @param endedAtMs 结束绝对时刻（`Date.now()`），默认 `Date.now()`。
   * @returns 汇总后的 `Record` 对象。
   */
  finish(now: number, endedAtMs: number = Date.now()): MapleRecord {
    // 结束前把「上次采样 → 结束时刻」这段真实时间也计入有效时长。
    this.advanceTimeTo(now);
    // 推进到 finishing。
    this.status = nextStatus(this.status, 'finishing');
    // 关闭最后一段。
    this.closeActiveSegment(now);
    // finishing → saving（汇总在 saving 语义下完成）。
    this.status = nextStatus(this.status, 'saving');

    // 结束等级兜底。
    if (this.lastLevel !== null && this.lastLevel >= 1) {
      this.levelEnd = this.lastLevel;
    }
    if (this.levelStart <= 0 && this.levelEnd > 0) {
      this.levelStart = this.levelEnd;
    }

    // 汇总时长。
    const duration = this.accumulatedMs;
    const summary = summarizeSegments(this.segments);

    // 存在未确认区间 → 净经验置 null（PRD P0-8）。
    if (summary.hasUnconfirmed || this.hasUnconfirmed) {
      this.netExp = null;
      this.readState = 'unconfirmedNet';
    } else {
      // 净经验 = 结束经验绝对值 − 起始经验绝对值（跨级时按累计增量，见 accumulate）。
      this.netExp = this.computeNetExp();
    }

    this.expPerHour = computeExpPerHour(this.netExp, duration > 0 ? duration : null);

    // 金币/小时。
    if (this.goldStart !== null && this.lastGold !== null) {
      this.goldPerHour = computeGoldPerHour(this.lastGold - this.goldStart, duration > 0 ? duration : null);
    } else {
      this.goldPerHour = null;
    }

    // 升级事件去重 & 顺序（按 t 升序）。
    this.levelUps.sort((a, b) => a.t - b.t);

    const record: MapleRecord = {
      id: this.id,
      createdAt: this.createdAt,
      endedAt: endedAtMs,
      durationMs: duration,
      status: 'ended',
      levelStart: this.levelStart,
      levelEnd: this.levelEnd,
      netExp: this.netExp,
      expPerHour: this.expPerHour,
      goldPerHour: this.goldPerHour,
      goldStart: this.goldStart,
      goldEnd: this.lastGold,
      levelUps: [...this.levelUps],
      segments: this.segments.map((s) => ({ ...s })),
      efficiencyTier: efficiencyTier(this.expPerHour),
      classId: null,
      clientInfo: { ...this.clientInfo },
      schemaVersion: SCHEMA_VERSION,
    };

    // saving → ended。
    this.status = nextStatus(this.status, 'ended');
    return record;
  }

  // -------------------------------------------------------------------------
  // 单帧摄取
  // -------------------------------------------------------------------------

  /**
   * 摄取一个采样点（单帧采集结果）。
   *
   * 流程（架构 §4.2）：
   * 1. 若非 `recording`（暂停/未开始/已结束）→ 忽略，返回当前状态；
   * 2. 记录 / 更新有效读数缓存（等级、经验、金币）；
   * 3. 推进 estimator（若有等级且读数可用）；
   * 4. 检测升级（等级跳变 + 比例不连续双证，或未校准时纯数值判定）；
   * 5. 推进速率对比；
   * 6. 生成并缓存 `Sample`（攒内存）；
   * 7. 返回 `IngestResult`。
   *
   * @param input 单帧采集结果。
   * @returns `IngestResult`。
   */
  ingestSample(input: SampleInput): IngestResult {
    const notices: string[] = [];

    if (!shouldCapture(this.status)) {
      return { readState: this.readState, changedMetrics: false, notices };
    }

    const t = input.t;
    let changed = false;

    // (2) 更新有效读数缓存 ------------------------------------------------
    const levelCalibrated = input.levelCalibrated ?? this.levelCalibrated;

    // 等级（未校准时恒为 null）。
    const level = levelCalibrated ? input.level : null;
    if (level !== null && Number.isFinite(level) && level >= 1) {
      if (this.lastLevel === null) {
        // 首个等级读数：初始化起止等级。
        this.lastLevel = level;
        if (this.levelStart <= 0) this.levelStart = level;
        this.levelEnd = level;
      } else if (level !== this.lastLevel) {
        // 等级跳变 → 升级事件（需与比例不连续双证；未校准时降级为纯数值判定）。
        this.handleLevelChange(level, t, input, notices);
        changed = true;
      }
    } else if (!levelCalibrated && !this.levelDegradeNotified) {
      // 降级路径提示（§5.9 第 4 条）。
      this.levelDegradeNotified = true;
      notices.push('LEVEL_NOT_CALIBRATED');
    }

    // 经验绝对值。
    const ab = input.expRaw;
    if (ab !== null && Number.isFinite(ab) && ab >= 0) {
      if (this.startExpAbs === null) {
        this.startExpAbs = ab;
      } else if (this.lastExpAbs !== null && ab < this.lastExpAbs) {
        // 绝对值回退：升级/跨级/换角色信号。不在此处累加负增量；
        // 由 estimator 的一致性判定与升级检测处理（§5.9）。
      }
      this.lastExpAbs = ab;
    }

    // 经验比例（缓存上一次**有效**比例）。
    const ratio = input.expPct;
    if (ratio !== null && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1) {
      // 是否命中不连续（调用方通常已传入 isDiscontinuous，这里以缓存比例兜底判定）。
      this.lastRatio = ratio;
    }

    // 金币。
    if (input.gold !== null && Number.isFinite(input.gold) && input.gold >= 0) {
      if (this.goldStart === null) this.goldStart = input.gold;
      this.lastGold = input.gold;
    }

    // (3) 推进 estimator ---------------------------------------------------
    let observe: ObserveResult | null = null;
    const observeLevel = levelCalibrated && level !== null
      ? level
      : (this.lastLevel ?? this.levelStart);
    const hasReading = (input.expRaw !== null && input.expRaw > 0) || (input.expPct !== null && input.expPct > 0);

    if (hasReading && observeLevel > 0) {
      const reading: Pick<ExpReading, 'absolute' | 'ratio' | 'estimated'> & { requiredExp?: number | null } = {
        absolute: input.expRaw,
        ratio: input.expPct,
        // 弱样本 / 不连续 → 标 estimated（不直接采信）。
        estimated: !!input.isWeak || !!input.isDiscontinuous,
        requiredExp: null,
      };
      const opts: ObserveOptions = {};
      observe = this.estimator.observe(observeLevel, reading, t, opts);
    }

    // (5) 速率对比推进 -----------------------------------------------------
    //     用「本级经验绝对值的变化 / 真实时间跨度」得到瞬时速率。
    //     只有本帧读到**新鲜的有效经验绝对值**时才推进速率样本：
    //     拒识帧（expRaw===null）**完全跳过** `pushRateSample` —— 既不推入伪造的
    //     0 样本，也不因窗口时间前移而误删仍然有效的旧样本（保持 last60s 不变），
    //     从而使恢复后的首个有效帧其 `delta` 与 `Δt` 覆盖同一时间跨度。
    const hasFreshExpReading = input.expRaw !== null && Number.isFinite(input.expRaw);
    if (hasFreshExpReading) {
      const instantRate = this.computeInstantRate(t, true);
      this.rateCompare = pushRateSample(this.rateCompare, t, instantRate);
    }

    // (6) 生成并缓存 Sample ------------------------------------------------
    const expNeeded = observeLevel > 0 ? this.requiredExpFor(observeLevel) : null;
    const sample: Sample = {
      id: uuid(),
      recordId: this.id,
      t,
      expRaw: input.expRaw,
      expPct: input.expPct,
      level,
      expNeeded,
      gold: input.gold,
      hp: input.hp,
      mp: input.mp,
      confidence: clamp01(input.confidence),
      readState: input.readState,
    };
    this.samples.push(sample);
    this.lastSample = sample;

    // (7) 状态与上下文推进 -------------------------------------------------
    //     `awaitingRecovery` 语义：中断/超时后置 true；随后恢复的**首个已确认帧**
    //     会被 confirmGate 映射为 `recovered`。注意 `recovered` 是**瞬时状态**，
    //     仅在恢复后首个确认帧出现一次，不作为持久状态；此处一旦见到 confirmed/
    //     recovered 即清除 `awaitingRecovery`，下次映射不再产出 recovered。
    //     采样点的 `readState` 存的是**每帧确认门判定后**的状态（非会话级），
    //     便于历史回放时识别「哪几帧是弱样本 / 中断帧」。
    this.readState = input.readState;

    // ★ 缺陷 1 修复：本帧为「中断恢复后的首个已确认帧」→ 关闭旧区间、开启新区间
    //   并标记 `isRecoveredStart=true`（对应 `ReadState='recovered'`：效率只统计
    //   恢复后的连续区间）。信号由采集管线经 `SampleInput.isRecoveredStart` 唯一传入。
    //
    //   为何要「关闭旧区间并开新区间」：遮挡/掉线等中断发生在 `recording` 期间时，
    //   旧区间此前从未被 `pause`/`finish` 关闭。若不在恢复帧切分区间，
    //   `Segment.isRecoveredStart` 将永远没有可承载的对象（形同虚设）。
    //   切分后语义与 `resume()` 一致：旧区间在中断前结束，新区间自恢复帧起始。
    if (input.isRecoveredStart && this.activeSegmentStart !== null) {
      this.closeActiveSegment(t);
      this.openSegment(t, true);
    }

    if (input.readState === 'interrupted' || input.readState === 'timeout') {
      this.awaitingRecovery = true;
      if (input.readState === 'interrupted') notices.push('KEEP_VISIBLE');
    } else if (input.readState === 'confirmed' || input.readState === 'recovered') {
      this.awaitingRecovery = false;
    }
    if (input.readState === 'unconfirmedNet') {
      this.hasUnconfirmed = true;
    }

    // 有效时长推进（仅 recording，且**本帧有有效读数**）。
    //
    // 语义（修复「无数据墙钟时间被计入时长」）：`durationMs` 只累加**相邻两个
    // 有效读数帧之间的时间跨度**；无有效读数的帧（如窗口被遮挡、文字+比例全拒识）
    // 不累加、且把基准 `lastValidT` 置 `null`（使其后的首个有效帧仅重建基准）。
    // 这样「遮挡 180s」无论发生在区段开头还是中间，都不会把 180s 墙钟计入分母，
    // 从而 `expPerHour = netExp / durationMs` 不被系统性低估。
    //
    // 判据放宽为「`expRaw !== null || expPct !== null`」——任一路径可读即算有效采样。
    //
    // 另：`lastT` 仍逐帧推进，仅用于「活动区间末端」与快照的当前时刻参考，
    // **不**再承担时长累加职责（与 `lastValidT` 分离，避免语义混用）。
    const hasValidReading = input.expRaw !== null || input.expPct !== null;
    if (hasValidReading) {
      if (this.lastValidT !== null && t > this.lastValidT) {
        this.accumulatedMs += t - this.lastValidT;
      }
      this.lastValidT = t;
      // 活动区间末端随有效读数推进。
      if (this.activeSegmentStart !== null && this.segments.length > 0) {
        const lastSeg = this.segments[this.segments.length - 1];
        lastSeg.endT = Math.max(lastSeg.endT, t);
      }
    } else {
      // 无有效读数：断开连续有效跨度，基准清零。其后首个有效帧只重建基准、
      // 不把这段「无数据墙钟时间」计入时长。
      this.lastValidT = null;
    }
    // `lastT` 逐帧推进（与读数有效性解耦），供快照/区间参考。
    if (this.lastT === null || t > this.lastT) {
      this.lastT = t;
    }

    if (changed) notices.push('METRICS_CHANGED');
    if (input.isWeak) notices.push('WEAK_SAMPLE');
    if (!this.levelCalibrated) notices.push('LEVEL_LOW_CONFIDENCE');

    // 去重 notices（保持顺序稳定）。
    const uniqueNotices = Array.from(new Set(notices));

    return { readState: this.readState, changedMetrics: changed, notices: uniqueNotices };
  }

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------

  /**
   * 取记录中累计的采样点（记录结束时批量落库用；返回**浅拷贝数组**）。
   *
   * @returns 采样点列表。
   */
  get pendingSamples(): Sample[] {
    return [...this.samples];
  }

  /** 已累计的采样点数量。 */
  get sampleCount(): number {
    return this.samples.length;
  }

  /**
   * 取某等级已知的「本级所需经验」。
   *
   * @param level 等级。
   * @returns 所需经验；未知为 `null`。
   */
  requiredExpFor(level: number): number | null {
    const req = this.estimator.requirementFor(level);
    return req === undefined ? null : req;
  }

  /**
   * 生成当前会话的实时快照（供 UI 响应式渲染）。
   *
   * @returns `SessionSnapshot`。
   */
  snapshot(): SessionSnapshot {
    const level = this.lastLevel ?? (this.levelStart > 0 ? this.levelStart : null);
    let levelInfo: LevelInfo | null = null;
    if (level !== null) {
      const expNeeded = this.requiredExpFor(level);
      levelInfo = levelProgress(level, expNeeded, this.lastExpAbs);
    }

    const duration = this.accumulatedMs;
    const summary = summarizeSegments(this.segments);
    const hasUnconfirmedNow = summary.hasUnconfirmed || this.hasUnconfirmed;

    const netExpNow = hasUnconfirmedNow ? null : this.computeNetExp();
    const expPerHourNow = computeExpPerHour(netExpNow, duration > 0 ? duration : null);
    const goldPerHourNow =
      this.goldStart !== null && this.lastGold !== null
        ? computeGoldPerHour(this.lastGold - this.goldStart, duration > 0 ? duration : null)
        : null;

    return {
      status: this.status,
      readState: hasUnconfirmedNow && this.status === 'ended' ? 'unconfirmedNet' : this.readState,
      levelInfo,
      rate: rateSnapshot(this.rateCompare),
      durationMs: duration,
      netExp: netExpNow,
      expPerHour: expPerHourNow,
      goldPerHour: goldPerHourNow,
      lastSample: this.lastSample,
      levelCalibrated: this.levelCalibrated,
    };
  }

  /**
   * 设定等级区域是否已校准（由采集循环在每帧同步校准态）。
   *
   * @param calibrated 是否已校准。
   */
  setLevelCalibrated(calibrated: boolean): void {
    this.levelCalibrated = calibrated;
  }

  // -------------------------------------------------------------------------
  // 内部：升级 / 区间 / 速率
  // -------------------------------------------------------------------------

  /**
   * 处理等级变化（升级 / 换角色 / 断线）。
   *
   * 判定（架构 §5.9）：
   * - **已校准等级**：升级 = 等级跳变 **且** 比例不连续下降（`isDiscontinuous`）双证；
   *   仅有等级跳变而比例未下降 → 判为换角色/断线 → 进 `interrupted`（不记升级）。
   * - **未校准等级**：升级检测退化为纯数值判定（`isDiscontinuous` 命中即视为疑似升级）。
   *
   * @param newLevel 新等级。
   * @param t 当前时刻（ms）。
   * @param input 本帧输入（含 `isDiscontinuous`）。
   * @param notices 输出用提示列表。
   */
  private handleLevelChange(
    newLevel: number,
    t: number,
    input: SampleInput,
    notices: string[],
  ): void {
    const fromLevel = this.lastLevel ?? this.levelStart;
    const discontinuous = !!input.isDiscontinuous;

    if (newLevel > fromLevel && (discontinuous || fromLevel <= 0)) {
      // 正常升级（比例不连续下降为第二证；首帧无比例时直接采信）。
      this.levelUps.push({ t, fromLevel, toLevel: newLevel });
      this.levelStart = this.levelStart > 0 ? this.levelStart : fromLevel;
      this.levelEnd = newLevel;
      notices.push('LEVEL_UP');
    } else if (this.levelCalibrated && !discontinuous) {
      // 等级变化但比例无不连续下降 → 换角色/断线 → interrupted（不计升级）。
      this.readState = 'interrupted';
      notices.push('CHARACTER_CHANGED');
    } else if (newLevel > fromLevel) {
      // 等级上升但比例未不连续（未校准降级路径）→ 记账升级，标注置信度较低。
      this.levelUps.push({ t, fromLevel, toLevel: newLevel });
      this.levelEnd = newLevel;
      notices.push('LEVEL_UP');
      if (!this.levelCalibrated) notices.push('LEVEL_LOW_CONFIDENCE');
    }

    this.lastLevel = newLevel;
    // 升级/换级后 estimator 需按新等级继续（旧等级状态保留在 estimator 内部）。
  }

  /**
   * 把有效时长推进到 `now`（**有效采样跨度**口径，与 `ingestSample` 一致）。
   *
   * 说明：`ingestSample` 已按相邻**有效读数帧**累加时长；本方法用于在**暂停/结束**时
   * 补上「最后一次有效读数 → 暂停/结束时刻」这段未被采样覆盖的真实时间，避免时长偏短。
   *
   * ⚠️ 口径统一（关键）：**只有当最近一帧（`lastT`）本身带有有效读数时**才补入尾巴。
   * 若最近一帧是无有效读数的帧（即末端已有数据间隙，例如窗口被遮挡），
   * 则**不补入** —— 否则会把「无数据的墙钟时间」重新计入时长，与改动 1 的语义冲突。
   *
   * @param now 目标时刻（ms）。
   */
  private advanceTimeTo(now: number): void {
    if (this.lastT === null) {
      this.lastT = now;
      return;
    }
    if (now <= this.lastT) return;

    // 末端是否仍处于「连续有效读数」：最近一帧时刻 === 最近有效读数时刻。
    const tailHasValidReading = this.lastValidT !== null && this.lastValidT === this.lastT;
    if (tailHasValidReading && this.lastValidT !== null) {
      this.accumulatedMs += now - this.lastValidT;
      this.lastValidT = now;
      if (this.activeSegmentStart !== null && this.segments.length > 0) {
        const lastSeg = this.segments[this.segments.length - 1];
        lastSeg.endT = Math.max(lastSeg.endT, now);
      }
    }
    this.lastT = now;
  }

  /**
   * 关闭当前活动区间。
   *
   * @param endT 结束时刻（ms）。
   */
  private closeActiveSegment(endT: number): void {
    if (this.activeSegmentStart === null) return;
    // 当前活动区间 = 已开启区间列表中最后一个（由 `openSegment` 维护），
    // 关闭即把其 `endT` 定稿到 `endT`，并清空活动指针。
    const last = this.segments[this.segments.length - 1];
    if (last) {
      last.endT = Math.max(last.startT, endT);
      last.confirmed = !this.hasUnconfirmed;
    }
    this.activeSegmentStart = null;
  }

  /**
   * 开启一个新的连续区间并设为当前活动区间。
   *
   * 语义：
   * - 新区间自 `startT` 起（`endT` 初始等于 `startT`，随有效帧推进）；
   * - `isRecoveredStart=true` 表示这段是「中断恢复后的连续区间」
   *   （对应 `ReadState='recovered'`：效率只统计恢复后的连续区间）；
   * - `confirmed` 初始为「本会话当前无未确认区间」。
   *
   * 注意：调用前应确保上一个活动区间已由 `closeActiveSegment` 关闭。
   *
   * @param startT 区间起点（ms，相对记录起点）。
   * @param isRecoveredStart 是否为恢复起点，默认 `false`。
   */
  private openSegment(startT: number, isRecoveredStart: boolean = false): void {
    this.segments.push({
      startT,
      endT: startT,
      isRecoveredStart,
      confirmed: !this.hasUnconfirmed,
    });
    this.activeSegmentStart = startT;
  }

  /**
   * 计算净经验。
   *
   * 规则：优先用「结束绝对值 − 起始绝对值」；若期间发生升级/跨级导致绝对值回退，
   * 则改用**累计正增量**近似（并已在 `hasUnconfirmed` 语义下可能置 `null`）。
   *
   * @returns 净经验；不可算为 `null`。
   */
  private computeNetExp(): number | null {
    if (this.startExpAbs === null || this.lastExpAbs === null) return null;
    const delta = this.lastExpAbs - this.startExpAbs;
    if (delta >= 0) return delta;
    // 绝对值回退（跨级）：用累计正增量兜底（保守，可能偏低）。
    return this.accumulatedPositiveDelta;
  }

  /** 累计的正向经验增量（本级内递增量的和；跨级回退时兜底用）。 */
  private accumulatedPositiveDelta = 0;

  /** 上一次用于计算瞬时速率的经验绝对值。 */
  private lastRateAbs: number | null = null;

  /** 上一次计算瞬时速率的时刻（ms）。 */
  private lastRateT: number | null = null;

  /**
   * 计算瞬时「经验/小时」（真实时间跨度口径）。
   *
   * 语义（修复读数间隙污染）：
   * - 仅当本帧有**新鲜的有效经验绝对值读数**（`hasFreshExpReading=true`）时才推进
   *   `lastRateAbs` / `lastRateT` 并可能产出速率；
   * - 拒识帧（`hasFreshExpReading=false`，如经验文字被拒识）**不推入速率样本**，
   *   也**不推进** `lastRateAbs` / `lastRateT` —— 从而使恢复后的首个有效帧，
   *   其 `delta` 与 `Δt` 覆盖**同一时间跨度**（从上一个有效读数帧算起），
   *   既不伪造 0 样本、也不高估速率；
   * - `accumulatedPositiveDelta` 同样只在有效读数帧上累加（避免重复计入同一增量）。
   *
   * @param t 当前时刻（ms）。
   * @param hasFreshExpReading 本帧是否有新鲜的有效经验绝对值读数（由 `ingestSample`
   *   依据 `input.expRaw !== null` 传入；**不能**靠 `abs === lastRateAbs` 判别，
   *   因为经验值恰好相同是合法情况，例如满格待升级）。
   * @returns 瞬时速率；无新鲜读数或不可算时为 `null`。
   */
  private computeInstantRate(t: number, hasFreshExpReading: boolean): number | null {
    // 拒识帧（无新鲜有效读数）→ 不推样本、不推进基准（关键修复点）。
    if (!hasFreshExpReading) {
      return null;
    }

    const abs = this.lastExpAbs;
    if (abs === null) {
      // 首个有效读数：建立基准，但本帧尚无可比对的上一值 → 不产出速率。
      this.lastRateAbs = abs;
      this.lastRateT = t;
      return null;
    }

    // 累加正向增量（跨级回退时不加负值）；仅在有效读数帧推进。
    if (this.lastRateAbs !== null && abs > this.lastRateAbs) {
      this.accumulatedPositiveDelta += abs - this.lastRateAbs;
    }

    let rate: number | null = null;
    if (this.lastRateAbs !== null && this.lastRateT !== null && t > this.lastRateT) {
      const delta = abs - this.lastRateAbs;
      // 只对正向增量计速率；回退（负 Δ）不计速率（避免负的 /小时）。
      if (delta >= 0) {
        rate = computeExpPerHour(delta, t - this.lastRateT);
      }
    }
    this.lastRateAbs = abs;
    this.lastRateT = t;
    return rate;
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/**
 * 从速率对比内部状态中提取纯数据快照。
 *
 * @param state 速率对比状态。
 * @returns 快照。
 */
function rateSnapshot(state: RateComparisonState): RateComparisonSnapshot {
  return {
    last60s: state.last60s,
    overallAvg: state.overallAvg,
    diffRatio: state.diffRatio,
    arrowVisible: state.arrowVisible,
    arrowUp: state.arrowUp,
  };
}

/**
 * 把数值裁剪到 [0,1]。
 *
 * @param v 输入值。
 * @returns 裁剪后的值。
 */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * 供采集循环使用的「区域键 → 该帧是否可用」辅助（纯函数）。
 *
 * @param region 区域（可为 `undefined`）。
 * @returns 是否可采（矩形有效）。
 */
export function isRegionKeyUsable(region: { w: number; h: number } | undefined): boolean {
  return !!region && region.w > 0 && region.h > 0;
}

/**
 * 区域键类型再导出（便于采集循环引用，避免多处 import 路径）。
 */
export type { RegionKey };
