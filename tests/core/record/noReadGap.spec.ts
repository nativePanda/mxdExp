/**
 * 回归测试：**无读数期间**不得扭曲「时长 / 读数状态」。
 *
 * ## 背景（缺陷来源，缺陷修复 #2）
 * 探针场景：**10s 正常采样 + 180s 全部拒识（窗口被遮挡）**，原实现出现三类失真：
 *
 * 1. **时长按墙钟累计**：`durationMs` 把「无读数」的 180s 墙钟时间也计入分母
 *    （190000ms vs 真实 10000ms），使 `expPerHour = netExp / durationMs` 被
 *    系统性**低估约 19 倍**。
 *    修复（改动 1）：`durationMs` 只累加**相邻两个「有效读数帧」之间**的时间跨度
 *    （`expRaw !== null || expPct !== null` 视为有效）；无读数帧断开连续跨度、
 *    基准 `lastValidT` 置 `null`，其后首个有效帧仅重建基准。
 *
 * 2. **读数状态卡在 `confirmed`**：长时间无读数后 `readState` 仍为 `confirmed`。
 *    修复（改动 2）：连续拒识达 `INTERRUPT_AFTER_FRAMES` 帧 → `interrupted`
 *    （由 `confirmGate.mapToReadState` 在采集管线中产出，**不**在 `RecordSession`
 *    内重复实现该逻辑）。
 *
 * 3. **`last60s` 冻结在陈旧值**（改动 3，见文末说明）。
 *
 * ## 断言口径
 * 本文件为**新增**回归用例；不放宽任何既有断言（`rateGap.spec.ts` / `recordMachine.spec.ts`
 * 保持原样通过）。
 */

import { describe, expect, it } from 'vitest';
import { RecordSession } from '@/core/record';
import { processFrame, createCaptureLoopState, type CaptureDeps } from '@/composables/useCaptureLoop';
import { TemplateBank } from '@/core/vision';
import type { PixelSource } from '@/types/vision';
import type { CalibrationConfig, RegionKey } from '@/types/calibration';
import { INTERRUPT_AFTER_FRAMES } from '@/constants';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 单帧输入构造辅助（默认带有效比例，故无读数帧需显式传 `expPct=null`）。 */
function frame(t: number, expRaw: number | null, expPct: number | null = 0.1) {
  return {
    t,
    expRaw,
    expPct,
    level: 200,
    gold: null,
    hp: null,
    mp: null,
    confidence: 0.9,
    readState: 'confirmed' as const,
    levelCalibrated: true,
  };
}

/** 构造最小校准配置（6 键齐全）。 */
function makeCalibration(
  overrides: Partial<Record<RegionKey, { x: number; y: number; w: number; h: number }>> = {},
): CalibrationConfig {
  const base = { x: 0, y: 0, w: 0.2, h: 0.02, status: 'located' as const };
  const mk = (key: RegionKey) => ({ ...base, ...(overrides[key] ?? {}) });
  return {
    version: 1,
    screenKey: 'test',
    regions: {
      expBar: mk('expBar'),
      expText: mk('expText'),
      level: { ...base, ...(overrides.level ?? {}) },
      gold: { ...base, ...(overrides.gold ?? {}) },
      hp: { ...base, ...(overrides.hp ?? {}) },
      mp: { ...base, ...(overrides.mp ?? {}) },
    },
    expSplit: false,
    updatedAt: 0,
  };
}

/** 纯色像素源。 */
function solidPixels(w: number, h: number, rgb: [number, number, number]): PixelSource {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

// ===========================================================================
// 改动 1：无读数期间时长不得按墙钟累计
// ===========================================================================

describe('改动 1 —— durationMs 只累计「有效读数帧之间」的跨度', () => {
  const TICK = 1000; // 1 帧 ≈ 1s（探针的采样节奏）
  const NORMAL_FRAMES = 10; // 10s 正常采样
  const OCCLUDED_FRAMES = 180; // 180s 全拒识

  it('★ 10s 正常 + 180s 全拒识 → durationMs≈10000（而非 190000）', () => {
    const s = new RecordSession({ levelCalibrated: true });
    s.start(0);

    // 10s 正常采样：每帧经验递增 100（比例也有效）。
    for (let k = 1; k <= NORMAL_FRAMES; k++) {
      s.ingestSample(frame(k * TICK, k * 100));
    }
    // 180s 全拒识：文字与比例**均为 null**（窗口被遮挡）。
    for (let k = 1; k <= OCCLUDED_FRAMES; k++) {
      s.ingestSample(frame((NORMAL_FRAMES + k) * TICK, null, null));
    }
    const endT = (NORMAL_FRAMES + OCCLUDED_FRAMES) * TICK; // 190000
    const rec = s.finish(endT, 1);

    // 有效时长 = 10s 正常采样区间；180s 遮挡不计入。
    expect(rec.durationMs).toBe(NORMAL_FRAMES * TICK); // 10000
    // 且经验/小时不再被系统性低估：netExp / 10s（而非 / 190s）。
    expect(rec.netExp).not.toBeNull();
    const expectedRate = ((rec.netExp as number) * 3_600_000) / (NORMAL_FRAMES * TICK);
    expect(rec.expPerHour).not.toBeNull();
    expect(rec.expPerHour as number).toBeCloseTo(expectedRate, 3);
  });

  it('遮挡发生在**区段开头** → 同样不计入（首个有效帧仅重建基准）', () => {
    const s = new RecordSession({ levelCalibrated: true });
    s.start(0);
    // 先来 180 帧拒识（一开始窗口就被遮住）。
    for (let k = 1; k <= OCCLUDED_FRAMES; k++) {
      s.ingestSample(frame(k * TICK, null, null));
    }
    // 随后 10s 正常采样。
    for (let k = 1; k <= NORMAL_FRAMES; k++) {
      s.ingestSample(frame((OCCLUDED_FRAMES + k) * TICK, k * 100));
    }
    const rec = s.finish((OCCLUDED_FRAMES + NORMAL_FRAMES) * TICK, 1);
    // 开头 180s 无数据 → 不计入；正文 10s（首帧重建基准，计 (N-1) 个间隔）。
    expect(rec.durationMs).toBe((NORMAL_FRAMES - 1) * TICK); // 9000
  });

  it('混合：正常-遮挡-正常 只累计两段正常跨度', () => {
    const s = new RecordSession({ levelCalibrated: true });
    s.start(0);
    // 段 A：起点 0 → 逐帧有效至 5000（计 [0,5000]=5000）。
    for (let k = 1; k <= 5; k++) s.ingestSample(frame(k * TICK, k * 100));
    // 遮挡：6000→10000（全拒识，断开基准）。
    for (let k = 6; k <= 10; k++) s.ingestSample(frame(k * TICK, null, null));
    // 段 B：11000 起重新锚定（首帧仅重建基准），至 15000 有效（计 [11000,15000]=4000）。
    for (let k = 11; k <= 15; k++) s.ingestSample(frame(k * TICK, k * 100));
    const rec = s.finish(15000, 1);

    // 段 A 计 [0,5000]=5000；段 B 计 [11000,15000]=4000；遮挡 [5000,11000] 不计。
    expect(rec.durationMs).toBe(5000 + 4000);
  });

  it('暂停期间无读数也不影响有效时长（与既有语义一致）', () => {
    const s = new RecordSession({ levelCalibrated: true });
    s.start(0);
    s.ingestSample(frame(1000, 100));
    s.ingestSample(frame(2000, 200));
    s.pause(3000); // 段 1 计 [0,3000]（起点锚定 + 逐帧 + 暂停尾巴）= 3000
    s.resume(60000); // 暂停 [3000,60000] 不计
    s.ingestSample(frame(61000, 300)); // 段 2 计 [60000,61000] = 1000
    s.ingestSample(frame(62000, 400)); // 段 2 计 [61000,62000] = 1000
    const rec = s.finish(62000, 1);
    // 段 1 = 3000；段 2 = 2000；暂停 [3000,60000] 不计 → 合计 5000。
    expect(rec.durationMs).toBe(5000);
  });
});

// ===========================================================================
// 改动 2：长时间无读数 → readState = interrupted（端到端经采集管线）
// ===========================================================================

describe('改动 2 —— 连续无读数达阈值 → readState = interrupted', () => {
  /**
   * 构造「完全无读数」的抓帧环境：经验条/数值框区域禁用（w=0）→
   * `hasAnyReading=false`，逐帧累加 `consecutiveReject`。
   */
  function occludedDeps(session: RecordSession, now: number, seq: number): CaptureDeps {
    const calib = makeCalibration({
      // expBar/expText 禁用 → 无任何经验读数。
      expBar: { x: 0, y: 0, w: 0, h: 0 },
      expText: { x: 0, y: 0, w: 0, h: 0 },
      level: { x: 0, y: 0, w: 0, h: 0 },
      gold: { x: 0, y: 0, w: 0, h: 0 },
    });
    return {
      grabRect: () => solidPixels(20, 4, [128, 128, 128]),
      bank: new TemplateBank('test'),
      calibration: calib,
      session,
      now,
      seq,
    };
  }

  it('★ 前 (阈值-1) 帧非 interrupted，第 阈值 帧起 interrupted', () => {
    const session = new RecordSession({ id: 'occl', levelCalibrated: true });
    session.start(0);
    const state = createCaptureLoopState();

    const states: string[] = [];
    for (let f = 1; f <= INTERRUPT_AFTER_FRAMES; f++) {
      const r = processFrame(state, occludedDeps(session, f * 1000, f - 1));
      states.push(r.readState);
    }

    // 未达阈值：无读数但未中断（waiting / 沿用上次确认语义，绝非 interrupted）。
    for (let i = 0; i < INTERRUPT_AFTER_FRAMES - 1; i++) {
      expect(states[i]).not.toBe('interrupted');
    }
    // 达到阈值：interrupted。
    expect(states[INTERRUPT_AFTER_FRAMES - 1]).toBe('interrupted');
    // 会话内部 readState 同步为 interrupted（真值来源为 confirmGate）。
    expect(session.readState).toBe('interrupted');
  });

  it('恢复有效读数后不再为 interrupted（转入 confirming/recovered）', () => {
    const session = new RecordSession({ id: 'rec', levelCalibrated: true });
    session.start(0);
    const state = createCaptureLoopState();

    // 先制造超过阈值的中断。
    for (let f = 1; f <= INTERRUPT_AFTER_FRAMES + 1; f++) {
      processFrame(state, occludedDeps(session, f * 1000, f - 1));
    }
    expect(session.readState).toBe('interrupted');

    // 恢复：经验条/数值框重新可用（同框、纯橙黄 → 比例 1；空库 → 文字拒识）。
    const restoredCalib = makeCalibration({
      expBar: { x: 0, y: 0, w: 0.2, h: 0.02 },
      expText: { x: 0, y: 0, w: 0.2, h: 0.02 },
      level: { x: 0, y: 0, w: 0, h: 0 },
      gold: { x: 0, y: 0, w: 0, h: 0 },
    });
    const restoredDeps: CaptureDeps = {
      grabRect: () => solidPixels(20, 4, [200, 120, 30]),
      bank: new TemplateBank('test'),
      calibration: restoredCalib,
      session,
      now: 10_000,
      seq: 999,
    };
    const r = processFrame(state, restoredDeps);
    expect(r.readState).not.toBe('interrupted');
    // 有读数（比例有效）→ 至少进入 confirming / recovered / confirmed 之一。
    expect(['confirming', 'recovered', 'confirmed', 'accumulating']).toContain(r.readState);
  });
});
