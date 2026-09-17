/**
 * 自举经验表仓储（expTable 表，主键 `level`）。
 *
 * 用途：内置样例表 / 运行中自动推导出的「本级所需经验」的持久化。
 * 依据：架构 A4（内置表优先，自举结果用于内置表缺失或标记 approximate 时）。
 */

import { getDb } from './database';
import type { ExpTableRow } from '@/types/models';
import type { ExpTableSource } from '@/types/enums';

/**
 * 取某等级的「升级所需经验」记录。
 *
 * @param level 等级。
 * @returns 经验表行或 `undefined`。
 */
export async function get(level: number): Promise<ExpTableRow | undefined> {
  const db = getDb();
  return db.expTable.get(level);
}

/**
 * 写入 / 更新某等级的经验表行。
 *
 * @param level 等级。
 * @param requiredExp 升到下一级所需经验。
 * @param approximate 是否为近似值。
 * @param source 数据来源。
 * @param now 更新时间戳，默认当前时间。
 * @returns 写入完成的 Promise。
 */
export async function put(
  level: number,
  requiredExp: number,
  approximate: boolean,
  source: ExpTableSource,
  now: number = Date.now(),
): Promise<void> {
  const db = getDb();
  const row: ExpTableRow = { level, requiredExp, approximate, source, updatedAt: now };
  await db.expTable.put(row);
}

/**
 * 批量写入经验表行。
 *
 * @param rows 经验表行列表。
 * @returns 写入条数。
 */
export async function bulkPut(rows: ExpTableRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getDb();
  await db.expTable.bulkPut(rows);
  return rows.length;
}

/**
 * 列出全部经验表行（按等级升序）。
 *
 * @returns 经验表行列表。
 */
export async function list(): Promise<ExpTableRow[]> {
  const db = getDb();
  const all = await db.expTable.toArray();
  return all.sort((a, b) => a.level - b.level);
}

/**
 * 按来源列出经验表行。
 *
 * @param source 数据来源。
 * @returns 经验表行列表。
 */
export async function listBySource(source: ExpTableSource): Promise<ExpTableRow[]> {
  const db = getDb();
  return db.expTable.where('source').equals(source).toArray();
}

/**
 * 构造一个「等级 → 所需经验」的映射（仅包含内置或已确认精确值）。
 *
 * @returns Map 对象。
 */
export async function toMap(): Promise<Map<number, number>> {
  const rows = await list();
  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(row.level, row.requiredExp);
  }
  return map;
}

/**
 * 删除某等级的经验表行。
 *
 * @param level 等级。
 * @returns 是否删除成功。
 */
export async function remove(level: number): Promise<boolean> {
  const db = getDb();
  const row = await db.expTable.get(level);
  if (!row) return false;
  await db.expTable.delete(level);
  return true;
}

/**
 * 清空经验表（「恢复出厂设置」用）。
 *
 * @returns 清空完成的 Promise。
 */
export async function clear(): Promise<void> {
  const db = getDb();
  await db.expTable.clear();
}
