/**
 * Dexie 数据库实例 + 表定义（架构文档 §3.5）。
 *
 * 五张表：records / samples / calibration / expTable / kv。
 *
 * 硬约定：
 * - 主键与索引定义必须与架构 §3.5 的草案逐字一致。
 * - `calibration` 主键是 `screenKey`；`expTable` 主键是 `level`；`kv` 主键是 `key`。
 */

import Dexie, { type Table } from 'dexie';
import type { CalibrationConfig } from '@/types/calibration';
import type { ExpTableRow, KvRow, Record as MapleRecord, Sample } from '@/types/models';

/** 数据库名。 */
export const DB_NAME = 'maple_exp_tracker';

/** 数据库版本。 */
export const DB_VERSION = 1;

/**
 * 冒险岛经验统计工具的 IndexedDB 数据库（Dexie 封装）。
 *
 * @example
 * ```ts
 * const db = getDb();
 * await db.records.add(record);
 * ```
 */
export class MapLogDatabase extends Dexie {
  /** 记录表（主键：id）。 */
  records!: Table<MapleRecord, string>;

  /** 采样点表（主键：id）。 */
  samples!: Table<Sample, string>;

  /** 校准配置表（主键：screenKey）。 */
  calibration!: Table<CalibrationConfig, string>;

  /** 经验表（主键：level）。 */
  expTable!: Table<ExpTableRow, number>;

  /** 通用键值表（主键：key）。 */
  kv!: Table<KvRow, string>;

  /** 构造数据库实例并定义版本 1 的表结构。 */
  constructor() {
    super(DB_NAME);
    this.version(DB_VERSION).stores({
      records: 'id, createdAt, status, levelEnd',
      samples: 'id, recordId, t, [recordId+t]',
      calibration: 'screenKey, updatedAt',
      expTable: 'level, source',
      kv: 'key',
    });
  }
}

/** 单例数据库实例（懒加载）。 */
let dbInstance: MapLogDatabase | null = null;

/**
 * 获取数据库单例。
 *
 * @returns 数据库实例。
 */
export function getDb(): MapLogDatabase {
  if (!dbInstance) {
    dbInstance = new MapLogDatabase();
  }
  return dbInstance;
}

/**
 * 关闭数据库连接（测试 / 清理用）。
 *
 * @returns 关闭完成的 Promise。
 */
export async function closeDb(): Promise<void> {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * 删除整个数据库（「清除所有记录」/ 恢复出厂时的深度清理用）。
 *
 * @returns 删除完成的 Promise。
 */
export async function deleteDb(): Promise<void> {
  await Dexie.delete(DB_NAME);
  dbInstance = null;
}
