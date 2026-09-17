/**
 * `useRecordSession` —— 把 `RecordSession` 接入 Vue 响应式。
 *
 * 依据：架构文档 §2.12 / §4.3（结束记录 → 保存 → 历史刷新时序）+
 * §5.8（采样点攒内存、结束批量落库）。
 *
 * 职责：
 * - 持有 `RecordSession` 实例并按状态机编排 `start/pause/resume/finish`；
 * - 暴露响应式的会话快照（`status` / `readState` / 指标）；
 * - `finish()` 时把汇总出的 `Record` 与累计采样点**批量落库**（`recordsRepo` + `samplesRepo`）。
 *
 * 依赖注入 `now` 时钟与仓储，便于在测试中替换（Node 下无 IndexedDB 时注入假仓储）。
 */

import { ref, shallowRef, computed, type Ref, type ComputedRef } from 'vue';
import type { Record as MapleRecord, ClientInfo } from '@/types/models';
import { recordsRepo, samplesRepo } from '@/db';
import { RecordSession, type SessionSnapshot } from '@/core/record';
import { MAX_CAPTURE_FPS } from '@/constants/perf';

/** 记录生命周期动作的编排接口。 */
export interface RecordSessionController {
  /** 当前会话（未开始为 `null`）。 */
  session: Ref<RecordSession | null>;
  /** 记录状态（响应式）。 */
  status: ComputedRef<SessionSnapshot['status']>;
  /** 实时快照。 */
  snapshot: Ref<SessionSnapshot | null>;
  /** 记录起点（`performance.now()` 口径）；未记录为 `null`。 */
  startedAt: Ref<number | null>;
  /** 上次保存的 `Record`（`finish` 后）。 */
  lastRecord: Ref<MapleRecord | null>;
  /** 是否正在保存。 */
  saving: Ref<boolean>;
  /** 开始记录。 */
  start: () => boolean;
  /** 暂停。 */
  pause: () => boolean;
  /** 继续。 */
  resume: () => boolean;
  /** 结束并落库。 */
  finish: () => Promise<MapleRecord | null>;
  /** 刷新快照（采集循环每帧调用）。 */
  refresh: () => void;
}

/** `useRecordSession` 的入参。 */
export interface UseRecordSessionOptions {
  /** 客户端环境快照提供者（分辨率/UA/校准版本）。 */
  clientInfo?: () => ClientInfo;
  /** 等级是否已校准的提供者。 */
  levelCalibrated?: () => boolean;
  /** 时钟（`performance.now()` 口径）；默认读全局 `performance`。 */
  now?: () => number;
  /** 绝对时钟（`Date.now()` 口径）；默认读全局 `Date`。 */
  nowMs?: () => number;
  /** 采集/检查频率提供者（用于诊断与限频提示）。 */
  captureFps?: () => number;
}

/**
 * 创建一个记录会话控制器（需在组件作用域内调用）。
 *
 * @param opts 可选依赖。
 * @returns `RecordSessionController`。
 */
export function useRecordSession(opts: UseRecordSessionOptions = {}): RecordSessionController {
  const session = shallowRef<RecordSession | null>(null);
  const snapshot = ref<SessionSnapshot | null>(null);
  const startedAt = ref<number | null>(null);
  const lastRecord = ref<MapleRecord | null>(null);
  const saving = ref(false);

  const perfNow = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const wallNow = opts.nowMs ?? (() => Date.now());

  const status = computed(() => snapshot.value?.status ?? 'idle');

  /**
   * 开始记录：新建会话 → `start(0)` → 建立快照。
   *
   * @returns 是否成功开始。
   */
  const start = (): boolean => {
    if (session.value && session.value.status !== 'ended' && session.value.status !== 'idle') {
      return false; // 已有进行中的会话
    }
    const s = new RecordSession({
      createdAtMs: wallNow(),
      levelCalibrated: opts.levelCalibrated?.() ?? false,
      clientInfo: opts.clientInfo?.(),
      levelStart: 0,
    });
    const started = s.start(0);
    if (!started) return false;
    session.value = s;
    startedAt.value = perfNow();
    lastRecord.value = null;
    snapshot.value = s.snapshot();
    return true;
  };

  /**
   * 暂停记录。
   *
   * @returns 是否成功暂停。
   */
  const pause = (): boolean => {
    const s = session.value;
    if (!s) return false;
    const t = perfNow() - (startedAt.value ?? perfNow());
    const ok = s.pause(t);
    if (ok) snapshot.value = s.snapshot();
    return ok;
  };

  /**
   * 继续记录（重置帧时间基准由采集循环处理；会话记录恢复起点）。
   *
   * @returns 是否成功继续。
   */
  const resume = (): boolean => {
    const s = session.value;
    if (!s) return false;
    const t = perfNow() - (startedAt.value ?? perfNow());
    const ok = s.resume(t);
    if (ok) snapshot.value = s.snapshot();
    return ok;
  };

  /**
   * 结束记录并批量落库（`finishing → saving → ended`）。
   *
   * 采样点**一次性批量落库**（§5.8）：超过内存阈值时按 `chunkSize` 分批。
   *
   * @returns 保存后的 `Record`；无会话返回 `null`。
   */
  const finish = async (): Promise<MapleRecord | null> => {
    const s = session.value;
    if (!s) return null;
    const t = perfNow() - (startedAt.value ?? perfNow());
    const record = s.finish(t, wallNow());
    snapshot.value = s.snapshot();

    saving.value = true;
    try {
      await recordsRepo.add(record);
      const samples = s.pendingSamples;
      if (samples.length > 0) {
        // 大量采样点分批写入，避免单次事务过大。
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
   * 刷新快照（采集循环每帧调用）。
   */
  const refresh = (): void => {
    const s = session.value;
    if (s) snapshot.value = s.snapshot();
  };

  // 采集/检查频率上限提示（预留：超出 MAX_CAPTURE_FPS 时可在 UI 提示）。
  void (opts.captureFps?.() ?? MAX_CAPTURE_FPS);

  return { session, status, snapshot, startedAt, lastRecord, saving, start, pause, resume, finish, refresh };
}
