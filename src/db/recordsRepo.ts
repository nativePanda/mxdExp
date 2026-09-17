/**
 * 记录仓储（records 表）。
 *
 * 职责：add / list / get / update / remove / clear / exportAll / importAll。
 */

import { getDb } from './database';
import type { Record as MapleRecord } from '@/types/models';
import { SCHEMA_VERSION } from '@/types/models';
import { parseExport, serializeExport, type ExportPayload } from '@/utils/json';

/**
 * 新增一条记录。
 *
 * @param record 记录对象。
 * @returns 写入后的主键（id）。
 */
export async function add(record: MapleRecord): Promise<string> {
  const db = getDb();
  await db.records.put(record);
  return record.id;
}

/**
 * 批量新增记录（幂等：同 id 覆盖）。
 *
 * @param records 记录列表。
 * @returns 写入条数。
 */
export async function bulkAdd(records: MapleRecord[]): Promise<number> {
  if (records.length === 0) return 0;
  const db = getDb();
  await db.records.bulkPut(records);
  return records.length;
}

/**
 * 按创建时间倒序列出全部记录。
 *
 * @returns 记录列表（最新的在前）。
 */
export async function list(): Promise<MapleRecord[]> {
  const db = getDb();
  const all = await db.records.toArray();
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 按主键取一条记录。
 *
 * @param id 记录 id。
 * @returns 记录或 `undefined`。
 */
export async function get(id: string): Promise<MapleRecord | undefined> {
  const db = getDb();
  return db.records.get(id);
}

/**
 * 更新一条记录（按 id 覆盖）。
 *
 * @param record 记录对象（须含 id）。
 * @returns 是否更新成功。
 */
export async function update(record: MapleRecord): Promise<boolean> {
  const db = getDb();
  const existing = await db.records.get(record.id);
  if (!existing) return false;
  await db.records.put(record);
  return true;
}

/**
 * 删除一条记录（同时删除其采样点）。
 *
 * @param id 记录 id。
 * @returns 是否删除成功。
 */
export async function remove(id: string): Promise<boolean> {
  const db = getDb();
  const existing = await db.records.get(id);
  if (!existing) return false;
  await db.transaction('rw', db.records, db.samples, async () => {
    await db.records.delete(id);
    await db.samples.where('recordId').equals(id).delete();
  });
  return true;
}

/**
 * 清空全部记录与采样点（「清除所有记录」）。
 *
 * @returns 清除完成的 Promise。
 */
export async function clear(): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.records, db.samples, async () => {
    await db.records.clear();
    await db.samples.clear();
  });
}

/**
 * 统计记录条数。
 *
 * @returns 记录条数。
 */
export async function count(): Promise<number> {
  const db = getDb();
  return db.records.count();
}

/**
 * 导出全部记录（含采样点）为 JSON 字符串。
 *
 * @returns JSON 文本。
 */
export async function exportAll(): Promise<string> {
  const db = getDb();
  const records = await db.records.toArray();
  const recordIds = new Set(records.map((r) => r.id));
  const allSamples = await db.samples.toArray();
  const samples = allSamples.filter((s) => recordIds.has(s.recordId));
  return serializeExport(records, samples);
}

/**
 * 导出全部记录为 `Blob`（供下载直接使用）。
 *
 * @returns JSON Blob。
 */
export async function exportAllBlob(): Promise<Blob> {
  const json = await exportAll();
  return new Blob([json], { type: 'application/json;charset=utf-8' });
}

/**
 * 从 JSON 文本导入记录（幂等：同 id 覆盖）。
 *
 * @param text 文件 JSON 文本。
 * @returns 导入结果（含成功条数与错误信息）。
 */
export async function importAll(
  text: string,
): Promise<{ ok: boolean; imported: number; error: string | null }> {
  const parsed = parseExport(text);
  if (!parsed.ok) {
    return { ok: false, imported: 0, error: parsed.error };
  }
  const payload: ExportPayload = parsed.value;
  const db = getDb();
  await db.transaction('rw', db.records, db.samples, async () => {
    if (payload.records.length > 0) {
      // 补齐 schemaVersion（兼容旧文件）
      const normalized = payload.records.map((r) => ({
        ...r,
        schemaVersion: typeof r.schemaVersion === 'number' ? r.schemaVersion : SCHEMA_VERSION,
      }));
      await db.records.bulkPut(normalized);
    }
    if (payload.samples.length > 0) {
      await db.samples.bulkPut(payload.samples);
    }
  });
  return { ok: true, imported: payload.records.length, error: null };
}
