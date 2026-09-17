/**
 * 校准仓储（calibration 表，主键 `screenKey`）。
 *
 * 职责：get(screenKey) / save(config)。
 */

import { getDb } from './database';
import type { CalibrationConfig } from '@/types/calibration';

/**
 * 按 `screenKey` 取校准配置。
 *
 * @param screenKey 画面指纹。
 * @returns 校准配置或 `undefined`。
 */
export async function get(screenKey: string): Promise<CalibrationConfig | undefined> {
  const db = getDb();
  return db.calibration.get(screenKey);
}

/**
 * 保存校准配置（幂等：同 `screenKey` 覆盖）。
 *
 * @param config 校准配置。
 * @returns 保存后的 `screenKey`。
 */
export async function save(config: CalibrationConfig): Promise<string> {
  const db = getDb();
  await db.calibration.put(config);
  return config.screenKey;
}

/**
 * 取最近更新的一条校准配置（跨分辨率兜底）。
 *
 * @returns 最近更新的校准配置或 `undefined`。
 */
export async function getLatest(): Promise<CalibrationConfig | undefined> {
  const db = getDb();
  const all = await db.calibration.toArray();
  if (all.length === 0) return undefined;
  return all.sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/**
 * 删除某 `screenKey` 的校准配置。
 *
 * @param screenKey 画面指纹。
 * @returns 是否删除成功。
 */
export async function remove(screenKey: string): Promise<boolean> {
  const db = getDb();
  const existing = await db.calibration.get(screenKey);
  if (!existing) return false;
  await db.calibration.delete(screenKey);
  return true;
}

/**
 * 清空全部校准配置（「恢复出厂设置」用）。
 *
 * @returns 清空完成的 Promise。
 */
export async function clear(): Promise<void> {
  const db = getDb();
  await db.calibration.clear();
}

/**
 * 列出全部校准配置。
 *
 * @returns 校准配置列表。
 */
export async function list(): Promise<CalibrationConfig[]> {
  const db = getDb();
  const all = await db.calibration.toArray();
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}
