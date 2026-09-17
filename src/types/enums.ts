/**
 * 全局状态机枚举 + 中文文案表（唯一定义处）。
 *
 * 硬约定（架构文档 §5.3）：
 * - 所有枚举都用**字符串字面量**（不是数字），存储层存字符串，
 *   便于导出 JSON 可读、跨版本兼容。
 * - UI 文案表也定义在本文件，与 PRD §6.2 / §6.4 逐字一致。
 * - 禁止在其他文件重复定义这些枚举值或文案。
 */

// ---------------------------------------------------------------------------
// 1. RecordStatus —— 记录状态机（PRD §6.2）
// ---------------------------------------------------------------------------

/** 记录状态机的全部合法状态。 */
export type RecordStatus =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'finishing'
  | 'saving'
  | 'ended';

/** `RecordStatus` 的合法取值列表（用于运行时校验/遍历）。 */
export const RECORD_STATUS_VALUES: readonly RecordStatus[] = [
  'idle',
  'recording',
  'paused',
  'finishing',
  'saving',
  'ended',
] as const;

/** `RecordStatus` → UI 文案（PRD §6.2 逐字一致）。 */
export const RECORD_STATUS_TEXT: Record<RecordStatus, string> = {
  idle: '未开始',
  recording: '记录中',
  paused: '已暂停',
  finishing: '正在结束',
  saving: '正在保存',
  ended: '已结束',
};

// ---------------------------------------------------------------------------
// 2. ReadState —— 读数确认状态（PRD §6.4）
// ---------------------------------------------------------------------------

/** 读数确认状态机的全部合法状态。 */
export type ReadState =
  | 'waiting'
  | 'accumulating'
  | 'confirming'
  | 'confirmed'
  | 'missingCrossLevel'
  | 'timeout'
  | 'interrupted'
  | 'unconfirmedNet'
  | 'recovered';

/** `ReadState` 的合法取值列表。 */
export const READ_STATE_VALUES: readonly ReadState[] = [
  'waiting',
  'accumulating',
  'confirming',
  'confirmed',
  'missingCrossLevel',
  'timeout',
  'interrupted',
  'unconfirmedNet',
  'recovered',
] as const;

/** `ReadState` → UI 文案（PRD §6.4 逐字一致）。 */
export const READ_STATE_TEXT: Record<ReadState, string> = {
  waiting: '等待读数',
  accumulating: '积累样本',
  confirming: '确认中',
  confirmed: '上次确认',
  missingCrossLevel: '跨级经验缺失',
  timeout: '经验变化未能在确认时间内完成核对',
  interrupted: '确认期间采集连续性中断',
  unconfirmedNet: '有一段经验未能确认，因此暂不显示本场净经验',
  recovered: '恢复后效率只统计恢复后的连续区间',
};

/**
 * `ReadState` 的补充说明文案（用于 UI 上的 hover 提示 / 解释性小字）。
 * 与 PRD §6.4 表格「含义」列一致；`recovered` 额外涵盖「恢复起点」语义。
 */
export const READ_STATE_DESC: Record<ReadState, string> = {
  waiting: '尚未取得有效画面',
  accumulating: '已取得读数，正在累积样本以确认',
  confirming: '正在核对本次经验变化',
  confirmed: '上一次成功确认完成',
  missingCrossLevel: '升级瞬间经验条被重置，跨级经验无法直接换算',
  timeout: '确认超时',
  interrupted: '确认过程中断（如暂停、画面遮挡）',
  unconfirmedNet: '存在未确认区间，导致净经验不显示',
  recovered: '中断恢复，只统计恢复后的连续区间 / 恢复起点',
};

/** 是否为「异常/需提示」的 ReadState（UI 用警告色渲染）。 */
export const READ_STATE_IS_ALERT: Record<ReadState, boolean> = {
  waiting: false,
  accumulating: false,
  confirming: false,
  confirmed: false,
  missingCrossLevel: true,
  timeout: true,
  interrupted: true,
  unconfirmedNet: true,
  recovered: false,
};

// ---------------------------------------------------------------------------
// 3. RegionStatus —— 校准区域定位状态（PRD §6.8 / §5.2）
// ---------------------------------------------------------------------------

/** 单个校准区域的定位状态。 */
export type RegionStatus = 'located' | 'unlocated' | 'identifying';

/** `RegionStatus` 的合法取值列表。 */
export const REGION_STATUS_VALUES: readonly RegionStatus[] = [
  'located',
  'unlocated',
  'identifying',
] as const;

/** `RegionStatus` → UI 文案（PRD §5.2：✓已定位 / ✗未定位 / 识别中）。 */
export const REGION_STATUS_TEXT: Record<RegionStatus, string> = {
  located: '已定位',
  unlocated: '未定位',
  identifying: '识别中',
};

// ---------------------------------------------------------------------------
// 4. EfficiencyTier —— 效率水平分档（PRD §6.1 / P0-12）
// ---------------------------------------------------------------------------

/** 效率水平四档。 */
export type EfficiencyTier = 'low' | 'mid' | 'high' | 'veryHigh';

/** `EfficiencyTier` 的合法取值列表（按由低到高排序）。 */
export const EFFICIENCY_TIER_VALUES: readonly EfficiencyTier[] = [
  'low',
  'mid',
  'high',
  'veryHigh',
] as const;

/** `EfficiencyTier` → UI 文案（PRD P0-12 逐字一致）。 */
export const EFFICIENCY_TIER_TEXT: Record<EfficiencyTier, string> = {
  low: '较低水平',
  mid: '中间水平',
  high: '较高水平',
  veryHigh: '高效水平',
};

// ---------------------------------------------------------------------------
// 5. PerfTier —— 识别性能档位（PRD §6.9 / §5.4）
// ---------------------------------------------------------------------------

/** 识别性能档位。 */
export type PerfTier = 'low' | 'mid' | 'default' | 'high' | 'ultra';

/** `PerfTier` 的合法取值列表（按由低到高排序）。 */
export const PERF_TIER_VALUES: readonly PerfTier[] = [
  'low',
  'mid',
  'default',
  'high',
  'ultra',
] as const;

/** `PerfTier` → UI 文案（PRD §5.4：低 / 中 / 默认 / 高 / 超高）。 */
export const PERF_TIER_TEXT: Record<PerfTier, string> = {
  low: '低',
  mid: '中',
  default: '默认',
  high: '高',
  ultra: '超高',
};

// ---------------------------------------------------------------------------
// 6. 采集区域键 —— 见 `src/types/calibration.ts`
// ---------------------------------------------------------------------------
// 注意：`RegionKey`（6 个区域键）与区域元数据表 `REGION_META` 的**唯一真相源**
// 是 `src/types/calibration.ts` + `src/constants/regions.ts`（架构 §3.5.1），
// 不在本文件重复定义，避免出现两份清单不一致。

// ---------------------------------------------------------------------------
// 7. ExpTableSource —— 经验表来源
// ---------------------------------------------------------------------------

/** 经验表数据来源。 */
export type ExpTableSource = 'builtin' | 'inferred' | 'imported';

/** `ExpTableSource` 的合法取值列表。 */
export const EXP_TABLE_SOURCE_VALUES: readonly ExpTableSource[] = [
  'builtin',
  'inferred',
  'imported',
] as const;

/** `ExpTableSource` → UI 文案。 */
export const EXP_TABLE_SOURCE_TEXT: Record<ExpTableSource, string> = {
  builtin: '内置样例',
  inferred: '自动推导',
  imported: '手动导入',
};

// ---------------------------------------------------------------------------
// 8. 通用枚举工具
// ---------------------------------------------------------------------------

/**
 * 判断某个字符串是否属于指定枚举的合法取值。
 *
 * @param values 枚举的合法取值列表（如 `RECORD_STATUS_VALUES`）。
 * @param value 待判定的值。
 * @returns 是否合法。
 */
export function isEnumValue<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}
