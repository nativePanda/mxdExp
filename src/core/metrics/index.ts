/**
 * `src/core/metrics/` 统一出口。
 *
 * 指标计算（/小时、速率对比、分档、等级进度、区间维护）：纯函数，零 DOM 依赖。
 */

export {
  expPerHour,
  goldPerHour,
  netExp,
  durationMs,
  MS_PER_HOUR,
} from './expPerHour';

export {
  createRateComparison,
  pushRateSample,
  mean,
  type RateSample,
  type RateComparisonSnapshot,
  type RateComparisonState,
} from './rateCompare';

export {
  createSegment,
  closeSegment,
  extendSegment,
  segmentDuration,
  totalDuration,
  confirmedDuration,
  hasUnconfirmedSegment,
  summarizeSegments,
} from './segments';

export {
  efficiencyTier,
  efficiencyTierDesc,
  EFFICIENCY_THRESHOLDS,
  type EfficiencyTierThresholds,
} from './efficiencyTier';

export {
  levelProgress,
  expPercent,
  expToNext,
} from './levelProgress';

export { isExpRatioDiscontinuity } from './discontinuity';
