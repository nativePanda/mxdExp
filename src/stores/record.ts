/**
 * RecordStore —— 记录状态：`status`、实时指标、`ReadState`、采样点缓冲。
 *
 * 依据：架构文档 §2.11 / §3.6 + §4.2 / §4.3（单帧更新 / 结束保存）+ §5.8（攒内存、批量落库）。
 *
 * 职责：
 * - 编排记录生命周期（`start/pause/resume/finish`），内部委托 `useRecordSession`；
 * - 采集循环每帧把 `FrameResult` 灌入本 store（更新实时指标）→ UI 响应式渲染；
 * - `finish()` 后触发一次「记录摘要」快照供历史页（历史 store 由 T04 负责 liveQuery）。
 */

import { defineStore } from 'pinia';
import { ref, computed, shallowRef, type Ref } from 'vue';
import type { Record as MapleRecord, ClientInfo } from '@/types/models';
import type { RecordStatus, ReadState } from '@/types/enums';
import { RecordSession, type SessionSnapshot, type IngestResult } from '@/core/record';
import { recordsRepo, samplesRepo } from '@/db';
import { MAX_CAPTURE_FPS } from '@/constants/perf';

/** 采集循环每帧灌入的最小载荷（避免 store 依赖 composable 类型）。 */
export interface FrameUpdate {
  /** 本帧后的读数状态。 */
  readState: ReadState;
  /** 本帧是否更新指标。 */
  changedMetrics: boolean;
  /** 提示 key。 */
  notices: string[];
  /** 本帧摄取结果。 */
  ingest: IngestResult;
}

/**
 * 记录 store（setup 风格）。
 */
export const useRecordStore = defineStore('record', () => {
  /** 当前会话。 */
  const session = shallowRef<RecordSession | null>(null);

  /** 实时快照。 */
  const snapshot = ref<SessionSnapshot | null>(null);

  /** 记录起点（`performance.now()` 口径）。 */
  const startedAt = ref<number | null>(null);

  /** 上次保存的 `Record`。 */
  const lastRecord = ref<MapleRecord | null>(null);

  /** 是否正在保存。 */
  const saving = ref(false);

  /** 最近一次提示 key 列表（去重）。 */
  const notices = ref<string[]>([]);

  /** 记录状态。 */
  const status = computed<RecordStatus>(() => snapshot.value?.status ?? 'idle');

  /** 读数确认状态。 */
  const readState = computed<ReadState>(() => snapshot.value?.readState ?? 'waiting');

  /** 是否正在记录。 */
  const isRecording = computed(() => status.value === 'recording');

  /** 当前等级信息。 */
  const levelInfo = computed(() => snapshot.value?.levelInfo ?? null);

  /** 速率对比快照。 */
  const rate = computed(() => snapshot.value?.rate ?? null);

  /** 有效时长（ms）。 */
  const durationMs = computed(() => snapshot.value?.durationMs ?? 0);

  /** 净经验。 */
  const netExp = computed(() => snapshot.value?.netExp ?? null);

  /** 经验/小时。 */
  const expPerHour = computed(() => snapshot.value?.expPerHour ?? null);

  /** 金币/小时。 */
  const goldPerHour = computed(() => snapshot.value?.goldPerHour ?? null);

  /** 等级是否已校准（降级标注用）。 */
  const levelCalibrated = computed(() => snapshot.value?.levelCalibrated ?? false);

  /**
   * 开始记录。
   *
   * @param opts 起始参数（客户端信息 / 等级校准态）。
   * @returns 是否成功开始。
   */
  const start = (opts: { clientInfo?: ClientInfo; levelCalibrated?: boolean } = {}): boolean => {
    if (session.value && session.value.status !== 'ended' && session.value.status !== 'idle') {
      return false;
    }
    const s = new RecordSession({
      createdAtMs: Date.now(),
      levelCalibrated: opts.levelCalibrated ?? false,
      clientInfo: opts.clientInfo,
      levelStart: 0,
    });
    const ok = s.start(0);
    if (!ok) return false;
    session.value = s;
    startedAt.value = typeof performance !== 'undefined' ? performance.now() : Date.now();
    lastRecord.value = null;
    notices.value = [];
    snapshot.value = s.snapshot();
    return true;
  };

  /**
   * 暂停记录。
   *
   * @returns 是否成功。
   */
  const pause = (): boolean => {
    const s = session.value;
    if (!s) return false;
    const ok = s.pause(nowRelative());
    if (ok) snapshot.value = s.snapshot();
    return ok;
  };

  /**
   * 继续记录。
   *
   * @returns 是否成功。
   */
  const resume = (): boolean => {
    const s = session.value;
    if (!s) return false;
    const ok = s.resume(nowRelative());
    if (ok) snapshot.value = s.snapshot();
    return ok;
  };

  /**
   * 结束记录并批量落库（`finishing → saving → ended`）。
   *
   * @returns 保存后的 `Record`；无会话返回 `null`。
   */
  const finish = async (): Promise<MapleRecord | null> => {
    const s = session.value;
    if (!s) return null;
    const record = s.finish(nowRelative(), Date.now());
    snapshot.value = s.snapshot();

    saving.value = true;
    try {
      await recordsRepo.add(record);
      const samples = s.pendingSamples;
      if (samples.length > 0) {
        await samplesRepo.bulkAddChunked(samples);
      }
    } finally {
      saving.value = false;
    }
    lastRecord.value = record;
    snapshot.value = s.snapshot();
    return record;
  };

  /**
   * 采集循环每帧灌入结果（更新实时指标）。
   *
   * @param frame 单帧载荷。
   */
  const applyFrame = (frame: FrameUpdate): void => {
    const s = session.value;
    if (!s) return;
    snapshot.value = s.snapshot();
    if (frame.notices.length > 0) {
      const merged = new Set([...notices.value, ...frame.notices]);
      notices.value = Array.from(merged);
    }
  };

  /**
   * 刷新快照（采集循环每帧调用）。
   */
  const refresh = (): void => {
    const s = session.value;
    if (s) snapshot.value = s.snapshot();
  };

  /**
   * 供采集循环访问当前会话（`RecordSession` 实例）。
   */
  const currentSession: Ref<RecordSession | null> = session;

  /** 计算相对记录起点的毫秒偏移。 */
  function nowRelative(): number {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return startedAt.value === null ? 0 : now - startedAt.value;
  }

  return {
    session,
    currentSession,
    snapshot,
    startedAt,
    lastRecord,
    saving,
    notices,
    status,
    readState,
    isRecording,
    levelInfo,
    rate,
    durationMs,
    netExp,
    expPerHour,
    goldPerHour,
    levelCalibrated,
    start,
    pause,
    resume,
    finish,
    applyFrame,
    refresh,
  };
});

/** 供诊断使用：当前采集频率上限（占位，避免魔法数字散落）。 */
export const RECORD_MAX_FPS = MAX_CAPTURE_FPS;
