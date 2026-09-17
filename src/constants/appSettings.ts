/**
 * 应用设置模型（PRD §6.9）。
 */

import type { PerfTier } from '@/types/enums';

/** 速率对比（近 60 秒 vs 全程平均）的阈值配置（PRD P0-7）。 */
export interface RateCompareSettings {
  /** 差值显示箭头阈值（默认 0.04 = 4%）。 */
  arrowThreshold: number;
  /** 回落隐藏阈值（默认 0.02 = 2%）。 */
  hideThreshold: number;
  /** 隐藏延迟（默认 1500ms）。 */
  hideDelayMs: number;
}

/** 应用设置。 */
export interface AppSettings {
  /** 识别性能档位。 */
  perfTier: PerfTier;
  /** 屏幕采集频率（次/秒）。 */
  captureFps: number;
  /** 画面检查频率（次/秒）。 */
  checkFps: number;
  /** 速率对比阈值。 */
  rateCompare: RateCompareSettings;
}
