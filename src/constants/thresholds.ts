/**
 * 阈值常量集中定义（★ 唯一来源）。
 *
 * 硬约定（架构文档 §5.7）：
 * - **所有魔法数字只在本文件定义一次**，其他文件一律 import，禁止散落重复。
 */

// ---------------------------------------------------------------------------
// 经验条比例识别（vision/ratio.ts）
// ---------------------------------------------------------------------------

/** 跨帧 2D 中值窗口帧数（预研 Q1：10~20 帧足够）。 */
export const FRAME_N = 12;

/** 逐列分位数（压掉覆盖在经验条上的白色数字），预研 exp5b。 */
export const PROFILE_PERCENTILE = 0.3;

/** 边界扫描允许的最大空洞比例（预研 exp1c）。 */
export const MAX_BAR_HOLES_RATIO = 0.01;

/** fillness 动态范围阈值：低于此值判全满/全空（预研 exp1c）。 */
export const FULL_EMPTY_DELTA = 6;

// ---------------------------------------------------------------------------
// 数字模板匹配（vision/readDigits.ts）
// ---------------------------------------------------------------------------

/** 模板匹配置信度下限（预研 exp2d）。 */
export const NCC_MIN = 0.55;

/** top1 − top2 最小间隔，低于此值拒识（预研 exp2d，最小实测 margin 0.22，故留余量）。 */
export const NCC_MARGIN = 0.03;

/** 字形归一化画布宽度（预研 exp2d）。 */
export const CANON_W = 24;

/** 字形归一化画布高度（预研 exp2d）。 */
export const CANON_H = 32;

/** 允许的字符集：数字 + `%` `,` `.` `/`（用于经验/金币/百分比/HP 样式）。 */
export const ALLOW_CHARS = '0123456789%,./';

// ---------------------------------------------------------------------------
// 百分比精度与速率对比（estimator / metrics）
// ---------------------------------------------------------------------------

/** 百分比小数位（区间收敛性；2 位可把每级所需经验锁到 ±110）。 */
export const PERCENTAGE_PRECISION = 2;

/** 差值显示箭头阈值 4%（PRD P0-7）。 */
export const RATE_ARROW = 0.04;

/** 回落隐藏阈值 2%（PRD P0-7）。 */
export const RATE_HIDE = 0.02;

/** 隐藏延迟 1.5s（PRD P0-7）。 */
export const RATE_HIDE_DELAY_MS = 1500;

/** 「近 60 秒」速率窗口（PRD P0-7）。 */
export const RATE_WINDOW_MS = 60000;

/**
 * 「全程平均」EMA 时间常数（ms）。
 *
 * 用于把 `overallAvg` 建构成**缓变的全会话平均**，与敏捷的 `last60s`（60s 窗口均值）
 * 形成两个真正独立的时间尺度。取 `RATE_WINDOW_MS` 的整数倍（默认 10×，即 10 分钟），
 * 使 `overallAvg` 在单次会话内近似"整场平均"，不会随窗口滑动突跳。
 */
export const RATE_EMA_TAU_MS = 600000;

// ---------------------------------------------------------------------------
// 自举经验表（estimator/ExpRequirementEstimator.ts）
// ---------------------------------------------------------------------------

/** 零样本确认所需连续帧数（枫记 `observe`）。 */
export const ZERO_CONFIRM_SAMPLES = 3;

/** 每个等级的候选样本缓存数（枫记 `observeRequirementCandidate`）。 */
export const SAMPLE_CACHE_PER_LEVEL = 3;

/** 单调性判定容差（枫记 `isMonotonicSample`）。 */
export const MONO_EPS = 2e-4;

/** 等级合法范围下限。 */
export const LEVEL_MIN = 1;

/** 等级合法范围上限。 */
export const LEVEL_MAX = 200;

// ---------------------------------------------------------------------------
// 等级区域读取节奏（架构 §5.9 本轮定稿）
// ---------------------------------------------------------------------------

/**
 * 等级区域每 N 帧读一次（省 CPU）。
 *
 * 依据：等级数字变化慢，逐帧读会平白多跑一次分割 + NCC；每 5 帧读一次把开销降到 1/5。
 * 最坏升级检测延迟 = N 帧（默认 5 帧，约 0.5~1.7s，视 fps）。
 */
export const LEVEL_READ_EVERY_N = 5;

/**
 * 触发「立即强制重读等级」的经验不连续阈值（比例突降或绝对值回退）。
 *
 * 语义（架构 §5.9）：
 * - 经验条**比例突降**：当前比例比上一读值下降超过本阈值（例：从接近满突降到接近空，
 *   典型为升级瞬间经验条被重置），即判为不连续；
 * - 经验**绝对值回退**：当前经验绝对值小于上一读值同样视为不连续（跨级经验缺失/换角色）。
 * 一旦命中该条件，**立即强制重读等级**，不受 `LEVEL_READ_EVERY_N` 帧节奏约束，
 * 保证升级 / 换角色 / 断线等关键时刻不漏检。
 *
 * 取值说明：架构 §5.7 该行标注为 `—`（留待实现期定），本实现按「比例突降」语义取
 * `0.5` —— 即比例下降超过一半（含 100%→接近 0% 的升级重置）判为不连续。
 * 该值低于 `FULL_EMPTY_DELTA` 归一化后的噪声幅度，不会因高光抖动误触发。
 */
export const LEVEL_DISCONTINUITY_ABS = 0.5;

// ---------------------------------------------------------------------------
// 读数确认门（core/record/confirmGate.ts，架构 §3.3 / §4.2 时序）
// ---------------------------------------------------------------------------

/**
 * 连续拒识达到此帧数 → `ReadState='interrupted'`（画面遮挡/卡顿/流中断）。
 *
 * 默认 3 帧；1Hz 下约 3 秒。UI 据此提示「请保持游戏画面可见」。
 */
export const INTERRUPT_AFTER_FRAMES = 3;

/**
 * 处于 `confirming` 超过此毫秒数仍未确认 → `ReadState='timeout'`。
 *
 * 语义：经验发生变化，但在确认时间内未完成交叉校验（PRD §6.4「确认超时」）。
 * 默认 5000ms（1Hz 下 5 帧）。
 */
export const CONFIRM_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// 宽容阈值（架构文档 §9.3：跨渲染管线降级链）
// ---------------------------------------------------------------------------

/** 宽容档 NCC 下限：仅在「连续 N 帧拒识」时临时启用。 */
export const NCC_MIN_TOLERANT = 0.45;

/** 宽容档 top1 − top2 最小间隔。 */
export const NCC_MARGIN_TOLERANT = 0.02;

/** 触发宽容档所需的连续拒识帧数。 */
export const TOLERANT_TRIGGER_FRAMES = 5;

// ---------------------------------------------------------------------------
// 采样点落库（架构 §5.8）
// ---------------------------------------------------------------------------

/** 长记录分批落库的分块大小（1 点/秒 × 3600s = 1h）。 */
export const SAMPLE_CHUNK_SIZE = 3600;

/** 采样点落库的内存阈值（超过则分批落库），单位：点。 */
export const SAMPLE_MEMORY_LIMIT = 7200;

// ---------------------------------------------------------------------------
// 常量汇总（便于测试一次性校验「全部常量存在」）
// ---------------------------------------------------------------------------

/** 全部阈值常量的只读快照（含名称 → 值），供单测断言完整性。 */
export const THRESHOLDS = {
  FRAME_N,
  PROFILE_PERCENTILE,
  MAX_BAR_HOLES_RATIO,
  FULL_EMPTY_DELTA,
  NCC_MIN,
  NCC_MARGIN,
  CANON_W,
  CANON_H,
  ALLOW_CHARS,
  PERCENTAGE_PRECISION,
  RATE_ARROW,
  RATE_HIDE,
  RATE_HIDE_DELAY_MS,
  RATE_WINDOW_MS,
  RATE_EMA_TAU_MS,
  ZERO_CONFIRM_SAMPLES,
  SAMPLE_CACHE_PER_LEVEL,
  MONO_EPS,
  LEVEL_MIN,
  LEVEL_MAX,
  LEVEL_READ_EVERY_N,
  LEVEL_DISCONTINUITY_ABS,
  INTERRUPT_AFTER_FRAMES,
  CONFIRM_TIMEOUT_MS,
  NCC_MIN_TOLERANT,
  NCC_MARGIN_TOLERANT,
  TOLERANT_TRIGGER_FRAMES,
  SAMPLE_CHUNK_SIZE,
  SAMPLE_MEMORY_LIMIT,
} as const;
