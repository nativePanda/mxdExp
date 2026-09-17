/**
 * JSON 序列化 / 反序列化 / 校验工具（导出 / 导入）。
 *
 * 硬约定（架构 §5.8）：
 * - 导出的 JSON 顶部带 `schemaVersion`；
 * - 导入时做兼容检查（P1-4 合并策略预留）。
 */

import { SCHEMA_VERSION, type Record as MapleRecord, type Sample } from '@/types/models';
import { isEnumValue, RECORD_STATUS_VALUES, type RecordStatus } from '@/types/enums';

/** 导出文件的载荷结构。 */
export interface ExportPayload {
  /** 导出格式标识。 */
  app: 'maple_exp_tracker';
  /** 数据模型版本号。 */
  schemaVersion: number;
  /** 导出时间戳（`Date.now()`）。 */
  exportedAt: number;
  /** 记录列表。 */
  records: MapleRecord[];
  /** 采样点列表（按记录分组，可选）。 */
  samples: Sample[];
}

/** 导入解析结果（成功 / 失败）。 */
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * 把记录与采样点序列化为可下载的 JSON 字符串。
 *
 * @param records 记录列表。
 * @param samples 采样点列表。
 * @param now 导出时间戳，默认当前时间。
 * @returns 格式化后的 JSON 字符串。
 */
export function serializeExport(
  records: MapleRecord[],
  samples: Sample[] = [],
  now: number = Date.now(),
): string {
  const payload: ExportPayload = {
    app: 'maple_exp_tracker',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    records,
    samples,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * 解析并校验导入的 JSON 文本。
 *
 * @param text 文件文本内容。
 * @returns 解析结果；失败时给出中文错误说明。
 */
export function parseExport(text: string): ParseResult<ExportPayload> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON 解析失败：文件内容不是合法的 JSON' };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'JSON 结构错误：顶层应为对象' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.app !== 'maple_exp_tracker') {
    return { ok: false, error: '文件来源不匹配：不是本工具导出的记录文件' };
  }
  const schemaVersion = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0;
  if (schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `文件版本（v${schemaVersion}）高于当前支持版本（v${SCHEMA_VERSION}），请升级工具后再导入`,
    };
  }
  if (!Array.isArray(obj.records)) {
    return { ok: false, error: 'JSON 结构错误：缺少 records 数组' };
  }
  const records = (obj.records as unknown[]).filter(isValidRecord);
  const samples = Array.isArray(obj.samples)
    ? (obj.samples as unknown[]).filter(isValidSample)
    : [];
  const payload: ExportPayload = {
    app: 'maple_exp_tracker',
    schemaVersion,
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : Date.now(),
    records,
    samples,
  };
  return { ok: true, value: payload };
}

/**
 * 校验一条记录是否结构合法（最小必需字段检查）。
 *
 * @param value 待校验对象。
 * @returns 是否合法。
 */
export function isValidRecord(value: unknown): value is MapleRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0) return false;
  if (typeof r.createdAt !== 'number') return false;
  if (!isEnumValue(RECORD_STATUS_VALUES, r.status as RecordStatus)) return false;
  if (typeof r.levelStart !== 'number' || typeof r.levelEnd !== 'number') return false;
  if (!Array.isArray(r.levelUps) || !Array.isArray(r.segments)) return false;
  return true;
}

/**
 * 校验一条采样点是否结构合法。
 *
 * @param value 待校验对象。
 * @returns 是否合法。
 */
export function isValidSample(value: unknown): value is Sample {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  if (typeof s.id !== 'string' || typeof s.recordId !== 'string') return false;
  if (typeof s.t !== 'number') return false;
  return true;
}

/**
 * 安全地深拷贝一个可结构化克隆的对象（用于防止引用共享污染）。
 *
 * @param value 待拷贝对象。
 * @returns 深拷贝结果。
 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
