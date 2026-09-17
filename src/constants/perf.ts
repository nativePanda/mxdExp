/**
 * 性能档位 → 采集/检查频率映射表（PRD §5.4 / P0-20）。
 *
 * 说明：P0 阶段「屏幕采集频率」与「画面检查频率」取相同值，
 * 二者在架构上分别对应 `captureFps`（Worker 定时器）与 `checkFps`（画面检查节拍）。
 */

import type { PerfTier } from '@/types/enums';

/** 一个性能档位对应的频率配置。 */
export interface PerfPreset {
  /** 屏幕采集频率（次/秒）。 */
  captureFps: number;
  /** 画面检查频率（次/秒）。 */
  checkFps: number;
  /** 该档位用途说明（UI 提示）。 */
  description: string;
}

/** 性能档位 → 频率预设映射（PRD §5.4 表格）。 */
export const PERF_PRESETS: Record<PerfTier, PerfPreset> = {
  low: { captureFps: 0.5, checkFps: 0.5, description: '低配机 / 降低 CPU 占用' },
  mid: { captureFps: 1, checkFps: 1, description: '较低负载' },
  default: { captureFps: 1, checkFps: 1, description: '出厂默认' },
  high: { captureFps: 2, checkFps: 2, description: '高速升级场景' },
  ultra: { captureFps: 4, checkFps: 4, description: '极限精度，高负载' },
};

/** 允许的频率范围（防止用户/导入数据设置出离谱值）。 */
export const MIN_CAPTURE_FPS = 0.25;

/** 最高采集频率上限（次/秒）。 */
export const MAX_CAPTURE_FPS = 10;

/**
 * 取某档位的频率预设；未知档位回落到 `default`。
 *
 * @param tier 性能档位。
 * @returns 频率预设。
 */
export function getPerfPreset(tier: PerfTier): PerfPreset {
  return PERF_PRESETS[tier] ?? PERF_PRESETS.default;
}

/**
 * 把频率约束到合法范围内。
 *
 * @param fps 待约束的频率。
 * @returns 合法频率。
 */
export function clampFps(fps: number): number {
  if (!Number.isFinite(fps)) return PERF_PRESETS.default.captureFps;
  return Math.min(MAX_CAPTURE_FPS, Math.max(MIN_CAPTURE_FPS, fps));
}
