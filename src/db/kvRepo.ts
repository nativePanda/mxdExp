/**
 * 通用键值仓储（kv 表，主键 `key`）。
 *
 * 用途：应用设置、字形模板库快照、导出/导入的临时状态等。
 */

import { getDb } from './database';
import type { KvRow } from '@/types/models';

/**
 * 读取一个键的值。
 *
 * @param key 键名。
 * @returns 值或 `undefined`。
 */
export async function get<T = unknown>(key: string): Promise<T | undefined> {
  const db = getDb();
  const row = await db.kv.get(key);
  return row ? (row.value as T) : undefined;
}

/**
 * 写入一个键值（幂等：同键覆盖）。
 *
 * @param key 键名。
 * @param value 值。
 * @returns 写入完成的 Promise。
 */
export async function set<T = unknown>(key: string, value: T): Promise<void> {
  const db = getDb();
  const row: KvRow<T> = { key, value };
  await db.kv.put(row);
}

/**
 * 读取一个键的值，不存在时返回默认值。
 *
 * @param key 键名。
 * @param fallback 默认值。
 * @returns 值或默认值。
 */
export async function getOrDefault<T>(key: string, fallback: T): Promise<T> {
  const value = await get<T>(key);
  return value === undefined ? fallback : value;
}

/**
 * 删除一个键。
 *
 * @param key 键名。
 * @returns 是否删除成功。
 */
export async function remove(key: string): Promise<boolean> {
  const db = getDb();
  const row = await db.kv.get(key);
  if (!row) return false;
  await db.kv.delete(key);
  return true;
}

/**
 * 批量写入键值对。
 *
 * @param entries 键值对列表。
 * @returns 写入条数。
 */
export async function setMany(entries: Array<{ key: string; value: unknown }>): Promise<number> {
  if (entries.length === 0) return 0;
  const db = getDb();
  const rows: KvRow[] = entries.map((e) => ({ key: e.key, value: e.value }));
  await db.kv.bulkPut(rows);
  return rows.length;
}

/**
 * 清空全部键值（「恢复出厂设置」用）。
 *
 * @returns 清空完成的 Promise。
 */
export async function clear(): Promise<void> {
  const db = getDb();
  await db.kv.clear();
}

/**
 * 列出全部键。
 *
 * @returns 键名列表。
 */
export async function keys(): Promise<string[]> {
  const db = getDb();
  return db.kv.toCollection().primaryKeys();
}
