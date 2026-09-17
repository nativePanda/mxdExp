/**
 * 回归测试：**缺陷 1 —— `Segment.isRecoveredStart` 恒为 `false`**。
 *
 * ## 背景（缺陷来源）
 * `confirmGate` 的恢复判定本身正确（`awaitingRecovery && observe.accepted → 'recovered'`），
 * 但「本帧是否为恢复后首个确认帧」这一信息此前**从未**从采集管线流向 `RecordSession`：
 * - `useCaptureLoop.processFrame` 中 `SampleInput.isRecoveredStart` 被硬编码为 `false`；
 * - `RecordSession.ingestSample` 因此永远无法开启带 `isRecoveredStart=true` 的区间；
 * - 结果：`core/metrics/segments.createSegment(startT, isRecoveredStart)` 的参数形同虚设，
 *   恢复后的连续区间无法被标记。
 *
 * ## 修复
 * - `processFrame` 以映射结果 `mappedState === 'recovered'` 作为「恢复起点」信号，
 *   经 `SampleInput.isRecoveredStart` 唯一传入；
 * - `RecordSession.ingestSample` 收到该信号后**关闭旧区间、开启新区间**并置 `true`。
 *
 * ## 断言口径
 * - **端到端**：经 `processFrame` 驱动「正常 → 遮挡超阈值 → 恢复」，
 *   断言会话最终 `segments` 中存在 `isRecoveredStart === true` 的区间；
 * - **单元**：直接构造 `SampleInput.isRecoveredStart=true` 喂给 `RecordSession`，
 *   断言区间被切分且新段落 `isRecoveredStart === true`；
 * - **不回归**：`isRecoveredStart` 默认仍为 `false`（未发生恢复时不误标）。
 */

import { describe, expect, it } from 'vitest';
import { RecordSession, type SampleInput } from '@/core/record';
import { processFrame, createCaptureLoopState, type CaptureDeps } from '@/composables/useCaptureLoop';
import { TemplateBank } from '@/core/vision';
import type { PixelSource } from '@/types/vision';
import type { CalibrationConfig, RegionKey } from '@/types/calibration';
import { INTERRUPT_AFTER_FRAMES } from '@/constants';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

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

/** 直接构造一帧 `SampleInput`（用于单元级断言）。 */
function sampleInput(overrides: Partial<SampleInput> = {}): SampleInput {
  return {
    t: 0,
    expRaw: 1000,
    expPct: 0.1,
    level: 200,
    gold: null,
    hp: null,
    mp: null,
    confidence: 0.9,
    readState: 'confirmed',
    levelCalibrated: true,
    ...overrides,
  };
}

// ===========================================================================
// 单元级：RecordSession 直接依据 isRecoveredStart 切分区间
// ===========================================================================

describe('缺陷 1（单元）—— RecordSession 依据 isRecoveredStart 开启恢复区间', () => {
  it('★ 传入 isRecoveredStart=true → 新区间被标记 isRecoveredStart=true', () => {
    const s = new RecordSession({ levelCalibrated: true });
    s.start(0);

    // 正常阶段：两帧有效读数。
    s.ingestSample(sampleInput({ t: 1000, expRaw: 1000, expPct: 0.1 }));
    s.ingestSample(sampleInput({ t: 2000, expRaw: 1100, expPct: 0.11 }));

    // 中断阶段：readState=interrupted（模拟遮挡达阈值）。
    s.ingestSample(sampleInput({ t: 3000, expRaw: null, expPct: null, readState: 'interrupted' }));

    // 恢复帧：readState=recovered 且 isRecoveredStart=true。
    s.ingestSample(
      sampleInput({ t: 4000, expRaw: 1200, expPct: 0.12, readState: 'recovered', isRecoveredStart: true }),
    );
    s.ingestSample(sampleInput({ t: 5000, expRaw: 1300, expPct: 0.13 }));

    const rec = s.finish(6000, 1);

    // 至少存在一个被标记为恢复起点的区间。
    const recovered = rec.segments.filter((seg) => seg.isRecoveredStart);
    expect(recovered.length).toBe(1);
    // 恢复区间自恢复帧（4000）起始。
    expect(recovered[0].startT).toBe(4000);
    // 恢复前区间不得被误标。
    expect(rec.segments[0].isRecoveredStart).toBe(false);
    // 恢复起点计数 == 1，且该区间起点严格晚于首段起点。
    expect(rec.segments.length).toBeGreaterThanOrEqual(2);
  });

  it('未发生恢复 → 所有区间 isRecoveredStart 均为 false（不误标）', () => {
    const s = new RecordSession({ levelCalibrated: true });
    s.start(0);
    s.ingestSample(sampleInput({ t: 1000, expRaw: 1000 }));
    s.ingestSample(sampleInput({ t: 2000, expRaw: 1100, expPct: 0.11 }));
    const rec = s.finish(3000, 1);
    expect(rec.segments.every((seg) => seg.isRecoveredStart === false)).toBe(true);
  });

  it('暂停→继续 的恢复区间同样被标记（resume 走 openSegment(true)）', () => {
    const s = new RecordSession({ levelCalibrated: true });
    s.start(0);
    s.ingestSample(sampleInput({ t: 1000, expRaw: 1000 }));
    s.pause(2000);
    s.resume(60000);
    s.ingestSample(sampleInput({ t: 61000, expRaw: 1100, expPct: 0.11 }));
    s.ingestSample(sampleInput({ t: 62000, expRaw: 1200, expPct: 0.12 }));
    const rec = s.finish(63000, 1);
    // 暂停后 resume 开启的新区间为恢复起点。
    expect(rec.segments.some((seg) => seg.isRecoveredStart === true)).toBe(true);
  });
});

// ===========================================================================
// 端到端：经 processFrame 驱动恢复，管线必须把信号送达 Segment
// ===========================================================================

describe('缺陷 1（端到端）—— processFrame 把 recovered 信号送达 Segment.isRecoveredStart', () => {
  /** 遮挡态抓帧环境：经验条/数值框/等级/金币区域禁用 → 无任何读数。 */
  function occludedDeps(session: RecordSession, now: number, seq: number): CaptureDeps {
    const calib = makeCalibration({
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

  it('★ 正常 → 遮挡超阈值 → 恢复：恢复帧产出的区间 isRecoveredStart=true', () => {
    const session = new RecordSession({ id: 'e2e-recover', levelCalibrated: true });
    session.start(0);
    const state = createCaptureLoopState();

    // 1) 正常阶段：经验条/数值框可用，纯橙黄（比例≈1；空库 → 文字拒识，但仍算有效比例读数）。
    const normalCalib = makeCalibration({
      expBar: { x: 0, y: 0, w: 0.2, h: 0.02 },
      expText: { x: 0, y: 0, w: 0.2, h: 0.02 },
      level: { x: 0, y: 0, w: 0, h: 0 },
      gold: { x: 0, y: 0, w: 0, h: 0 },
    });
    const normalDeps: CaptureDeps = {
      grabRect: () => solidPixels(20, 4, [200, 120, 30]),
      bank: new TemplateBank('test'),
      calibration: normalCalib,
      session,
      now: 1000,
      seq: 0,
    };
    for (let f = 0; f < 3; f++) {
      processFrame(state, { ...normalDeps, now: (f + 1) * 1000, seq: f });
    }

    // 2) 遮挡阶段：连续拒识超过阈值 → interrupted、awaitingRecovery 置位。
    for (let f = 0; f <= INTERRUPT_AFTER_FRAMES; f++) {
      processFrame(state, occludedDeps(session, 10_000 + f * 1000, 100 + f));
    }
    expect(session.readState).toBe('interrupted');

    // 3) 恢复阶段：画面重新可用 → 恢复帧应被映射为 recovered，并驱动区间切分。
    let sawRecovered = false;
    for (let f = 0; f < 3; f++) {
      const r = processFrame(state, {
        ...normalDeps,
        now: 20_000 + f * 1000,
        seq: 200 + f,
      });
      if (r.readState === 'recovered') sawRecovered = true;
    }
    expect(sawRecovered).toBe(true);

    const rec = session.finish(30_000, 1);
    // ★ 核心断言：管线已把恢复信号送达 Segment，恢复区间被正确标记。
    expect(rec.segments.some((seg) => seg.isRecoveredStart === true)).toBe(true);
  });
});
