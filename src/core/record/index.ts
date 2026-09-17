/**
 * `src/core/record/` 统一出口。
 *
 * 记录状态机与会话核心（纯 TS，零 DOM / 零 Vue 依赖，可在 Node 下单测）。
 */

export {
  RECORD_TRANSITIONS,
  canTransition,
  nextStatus,
  isTerminalStatus,
  isRecordingStatus,
  shouldCapture,
  assertTransition,
} from './recordMachine';

export {
  mapToReadState,
  advanceGateContext,
  isTrustedState,
  type ReadSignals,
  type ReadGateContext,
} from './confirmGate';

export {
  RecordSession,
  isRegionKeyUsable,
  type SampleInput,
  type IngestResult,
  type RecordSessionOptions,
  type SessionSnapshot,
  type RegionKey,
} from './RecordSession';
