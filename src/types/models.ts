/**
 * 数据模型接口定义。
 *
 * 依据：PRD §6（数据模型）+ 架构文档 §3.5（持久化类图）。
 *
 * 硬约定（架构文档 §5.2 / §5.4）：
 * - 时间基准：`t` = `performance.now() - recordStartedAt`（ms，相对记录起点）。
 *   `Record.createdAt` / `endedAt` 用 `Date.now()`（绝对时间，用于历史展示）。
 * - 拒识约定：识别失败的字段一律存 `null`（**不是** -1 / 0）。
 * - `netExp` 存在未确认区间时置 `null`。
 */

import type { EfficiencyTier, ExpTableSource, ReadState, RecordStatus } from './enums';

// ---------------------------------------------------------------------------
// 连续区间 Segment（PRD §6.5）
// ---------------------------------------------------------------------------

/** 一段连续有效的统计区间（用于「恢复后只统计恢复后的连续区间」）。 */
export interface Segment {
  /** 区间起点（ms，相对记录起点）。 */
  startT: number;
  /** 区间终点（ms，相对记录起点）。 */
  endT: number;
  /** 是否为恢复起点（中断恢复后的第一段）。 */
  isRecoveredStart: boolean;
  /** 该区间是否被完整确认。 */
  confirmed: boolean;
}

// ---------------------------------------------------------------------------
// 升级事件 LevelUpEvent
// ---------------------------------------------------------------------------

/** 一次升级事件。 */
export interface LevelUpEvent {
  /** 事件发生时刻（ms，相对记录起点）。 */
  t: number;
  /** 升级前等级。 */
  fromLevel: number;
  /** 升级后等级。 */
  toLevel: number;
}

// ---------------------------------------------------------------------------
// 等级信息 LevelInfo（PRD §6.6）
// ---------------------------------------------------------------------------

/** 当前等级与经验进度（UI 渲染用）。 */
export interface LevelInfo {
  /** 当前等级。 */
  level: number;
  /** 当前经验值（本级内）。 */
  currentExp: number;
  /** 当前百分比 0–100。 */
  expPercent: number;
  /** 本级共需经验。 */
  expNeeded: number;
  /** 距升级所需经验。 */
  expToNext: number;
}

// ---------------------------------------------------------------------------
// 采样点 Sample（PRD §6.3）
// ---------------------------------------------------------------------------

/** 单个采样点。所有识别失败字段一律为 `null`。 */
export interface Sample {
  /** 采样点 id（UUID）。 */
  id: string;
  /** 所属记录 id。 */
  recordId: string;
  /** 相对记录起点的毫秒偏移（`performance.now() - recordStartedAt`）。 */
  t: number;
  /** OCR 原始经验读数；识别失败为 `null`。 */
  expRaw: number | null;
  /** 经验条填充比例（像素法，0–1）；识别失败为 `null`。 */
  expPct: number | null;
  /** 当前等级；识别失败为 `null`。 */
  level: number | null;
  /** 本级所需经验；未知为 `null`。 */
  expNeeded: number | null;
  /** 当前金币；识别失败为 `null`。 */
  gold: number | null;
  /** HP（P1）；识别失败为 `null`。 */
  hp: number | null;
  /** MP（P1）；识别失败为 `null`。 */
  mp: number | null;
  /** 该采样点识别置信度 0–1。 */
  confidence: number;
  /** 该采样点的读数确认状态。 */
  readState: ReadState;
}

// ---------------------------------------------------------------------------
// 客户端信息 ClientInfo（PRD §6.1 `clientInfo`）
// ---------------------------------------------------------------------------

/** 记录当时的客户端环境快照（分辨率 / UA / 校准版本）。 */
export interface ClientInfo {
  /** 画面原始宽度（px）。 */
  width: number;
  /** 画面原始高度（px）。 */
  height: number;
  /** 浏览器 UA。 */
  ua: number | string;
  /** 校准配置版本快照。 */
  calibVersion: number;
}

// ---------------------------------------------------------------------------
// 记录 Record（PRD §6.1）
// ---------------------------------------------------------------------------

/** 一次完整记录的核心总结。 */
export interface Record {
  /** UUID。 */
  id: string;
  /** 记录开始时间戳（`Date.now()`）。 */
  createdAt: number;
  /** 结束时间戳（`Date.now()`）；未结束为 `null`。 */
  endedAt: number | null;
  /** 有效记录时长（ms，不含暂停）。 */
  durationMs: number;
  /** 记录状态。 */
  status: RecordStatus;
  /** 开始时的等级。 */
  levelStart: number;
  /** 结束时的等级。 */
  levelEnd: number;
  /** 净经验；若存在未确认区间则为 `null`（不显示）。 */
  netExp: number | null;
  /** 经验/小时。 */
  expPerHour: number | null;
  /** 金币/小时。 */
  goldPerHour: number | null;
  /** 起始金币。 */
  goldStart: number | null;
  /** 结束金币。 */
  goldEnd: number | null;
  /** 本次记录内的升级事件列表。 */
  levelUps: LevelUpEvent[];
  /** 连续有效统计区间。 */
  segments: Segment[];
  /** 效率水平分档。 */
  efficiencyTier: EfficiencyTier;
  /** 职业标注（P2 使用）；未标注为 `null`。 */
  classId: string | null;
  /** 客户端环境快照。 */
  clientInfo: ClientInfo;
  /** 数据模型版本号（导出/导入兼容检查用）。 */
  schemaVersion: number;
}

// ---------------------------------------------------------------------------
// 经验表行 ExpTableRow（架构 §3.5）
// ---------------------------------------------------------------------------

/** 某等级「升级所需经验」的一条记录。 */
export interface ExpTableRow {
  /** 等级（主键）。 */
  level: number;
  /** 升到下一级所需经验。 */
  requiredExp: number;
  /** 该值是否为近似/推导值（非精确来源）。 */
  approximate: boolean;
  /** 数据来源：builtin / inferred / imported。 */
  source: ExpTableSource;
  /** 最近更新时间戳（`Date.now()`）。 */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// 通用键值行 KvRow（架构 §3.5）
// ---------------------------------------------------------------------------

/** 通用键值存储行（设置、模板库自举快照等）。 */
export interface KvRow<T = unknown> {
  /** 键（主键）。 */
  key: string;
  /** 值（任意可结构化克隆的数据）。 */
  value: T;
}

// ---------------------------------------------------------------------------
// 当前数据模型版本
// ---------------------------------------------------------------------------

/** 数据模型版本号（`Record.schemaVersion` 与导出 JSON 顶部共用）。 */
export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建一个空的连续区间。
 *
 * @param startT 区间起点（ms）。
 * @returns 新区间。
 */
export function createSegment(startT: number): Segment {
  return { startT, endT: startT, isRecoveredStart: false, confirmed: false };
}

/**
 * 创建一个升级事件。
 *
 * @param t 事件时刻（ms）。
 * @param fromLevel 升级前等级。
 * @param toLevel 升级后等级。
 * @returns 新升级事件。
 */
export function createLevelUpEvent(t: number, fromLevel: number, toLevel: number): LevelUpEvent {
  return { t, fromLevel, toLevel };
}

/**
 * 创建一个默认的客户端信息快照（在无法获取真实环境时的兜底值）。
 *
 * @returns 默认 `ClientInfo`。
 */
export function createDefaultClientInfo(): ClientInfo {
  return { width: 0, height: 0, ua: '', calibVersion: 0 };
}
