/**
 * `src/core/estimator/` 统一出口。
 *
 * 自举经验表 + 交叉校验（移植枫记 `exp-requirement-estimator`）：纯函数 + 类，
 * 零 DOM、零 Vue 依赖。
 */

export {
  rangeFromReading,
  intersectRanges,
  rangeContains,
  pickFromRange,
  ratioToAbsolute,
  isConsistent,
  isValidReading,
  type Range,
} from './rangeFromReading';

export {
  isValidLevel,
  toRequiredExp,
  isMonotonicSample,
  type CandidateSample,
} from './guards';

export {
  ExpRequirementEstimator,
  type ObserveResult,
  type ObserveOptions,
} from './ExpRequirementEstimator';
