/**
 * 采样点仓储（samples 表）。
 *
 * 职责：bulkAdd / byRecord / 降采样。
 *
 * 架构 §5.8：记录进行中采样点攒在内存，结束时 bulkAdd 一次性落库，
 * 避免每秒写 IndexedDB 造成卡顿；长记录（>2h）超过内存阈值时按 chunkSize 分批落库。
 */

import { getDb } from './database';
import type { Sample } from '@/types/models';
import { SAMPLE_CHUNK_SIZE } from '@/constants/thresholds';

/**
 * 批量新增采样点（幂等：同 id 覆盖）。
 *
 * @param samples 采样点列表。
 * @returns 写入条数。
 */
export async function bulkAdd(samples: Sample[]): Promise<number> {
  if (samples.length === 0) return 0;
  const db = getDb();
  await db.samples.bulkPut(samples);
  return samples.length;
}

/**
 * 分批新增采样点（长记录落库用，避免单次事务过大）。
 *
 * @param samples 采样点列表。
 * @param chunkSize 分块大小，默认 `SAMPLE_CHUNK_SIZE`（3600）。
 * @returns 写入条数。
 */
export async function bulkAddChunked(
  samples: Sample[],
  chunkSize: number = SAMPLE_CHUNK_SIZE,
): Promise<number> {
  if (samples.length === 0) return 0;
  const db = getDb();
  const size = chunkSize > 0 ? chunkSize : SAMPLE_CHUNK_SIZE;
  let written = 0;
  for (let i = 0; i < samples.length; i += size) {
    const chunk = samples.slice(i, i + size);
    await db.samples.bulkPut(chunk);
    written += chunk.length;
  }
  return written;
}

/**
 * 按记录 id 取全部采样点（按 `t` 升序）。
 *
 * @param recordId 记录 id。
 * @returns 采样点列表。
 */
export async function byRecord(recordId: string): Promise<Sample[]> {
  const db = getDb();
  const list = await db.samples.where('recordId').equals(recordId).toArray();
  return list.sort((a, b) => a.t - b.t);
}

/**
 * 按时间区间取采样点（闭区间，`[startT, endT]`）。
 *
 * @param recordId 记录 id。
 * @param startT 起点（ms）。
 * @param endT 终点（ms）。
 * @returns 采样点列表。
 */
export async function byRecordRange(
  recordId: string,
  startT: number,
  endT: number,
): Promise<Sample[]> {
  const db = getDb();
  const list = await db.samples.where('[recordId+t]').between([recordId, startT], [recordId, endT], true, true).toArray();
  return list.sort((a, b) => a.t - b.t);
}

/**
 * 删除某条记录的全部采样点。
 *
 * @param recordId 记录 id。
 * @returns 删除条数。
 */
export async function removeByRecord(recordId: string): Promise<number> {
  const db = getDb();
  return db.samples.where('recordId').equals(recordId).delete();
}

/**
 * 对采样点列表做等间隔降采样（导出时可选，见架构 A6）。
 *
 * @param samples 采样点列表（假定已按 `t` 升序）。
 * @param maxPoints 目标最大点数；<=0 或大于原长度时不降采样。
 * @returns 降采样后的列表。
 */
export function downsample(samples: Sample[], maxPoints: number): Sample[] {
  if (maxPoints <= 0 || samples.length <= maxPoints) return samples;
  const step = (samples.length - 1) / (maxPoints - 1);
  const result: Sample[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    result.push(samples[Math.round(i * step)]);
  }
  return result;
}

/**
 * 统计某条记录的采样点数量。
 *
 * @param recordId 记录 id。
 * @returns 采样点数量。
 */
export async function countByRecord(recordId: string): Promise<number> {
  const db = getDb();
  return db.samples.where('recordId').equals(recordId).count();
}
