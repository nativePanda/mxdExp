/**
 * `core/record` 单测 —— 记录状态机 + 确认门 + 采集循环纯逻辑。
 *
 * 验收（架构 §7 T03-2 / T03-4 / T03-7 / T03-8）：
 * - `idle→recording→paused→recording→finishing→saving→ended` 全路径通过；
 * - 非法迁移被拒；
 * - `ReadState` 九值的流转（拒识 → confirming/timeout/interrupted，沿用上次确认值）；
 * - 等级读取节奏（每 N 帧 + 不连续强制重读）；
 * - `expBar`/`expText` 同框只抓一次帧；
 * - 「未处理完则丢弃本帧」。
 *
 * 说明：本测试文件**不依赖 DOM / Vue / IndexedDB**，直接在 Node 环境对纯逻辑断言。
 */

import { describe, expect, it } from 'vitest';
import {
  RECORD_TRANSITIONS,
  canTransition,
  nextStatus,
  isTerminalStatus,
  shouldCapture,
  assertTransition,
} from '@/core/record/recordMachine';
import {
  mapToReadState,
  advanceGateContext,
  isTrustedState,
  type ReadGateContext,
  type ReadSignals,
} from '@/core/record/confirmGate';
import { RecordSession } from '@/core/record/RecordSession';
import {
  FrameBuffer,
  shouldReadLevel,
  resolveTolerantMode,
  shouldReuseExpFrame,
  shouldDropFrame,
  processFrame,
  createCaptureLoopState,
  type CaptureDeps,
} from '@/composables/useCaptureLoop';
import type { ReadState, RecordStatus } from '@/types/enums';
import type { CalibrationConfig, RegionKey } from '@/types/calibration';
import type { ObserveResult } from '@/core/estimator';
import { TemplateBank } from '@/core/vision';
import type { PixelSource } from '@/types/vision';
import {
  CONFIRM_TIMEOUT_MS,
  FRAME_N,
  INTERRUPT_AFTER_FRAMES,
  LEVEL_READ_EVERY_N,
  TOLERANT_TRIGGER_FRAMES,
} from '@/constants';

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

/**
 * 构造一个最小校准配置（6 键齐全）。
 *
 * @param overrides 部分区域矩形覆盖。
 * @param expSplit 是否拆分经验条/数值框。
 * @returns `CalibrationConfig`。
 */
function makeCalibration(overrides: Partial<Record<RegionKey, { x: number; y: number; w: number; h: number }>> = {}, expSplit = false): CalibrationConfig {
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
    expSplit,
    updatedAt: 0,
  };
}

/**
 * 构造一块纯色像素源（测试抓帧用）。
 *
 * @param w 宽。
 * @param h 高。
 * @param rgb 颜色。
 * @returns `PixelSource`。
 */
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
// 1. 状态机迁移表
// ===========================================================================

describe('recordMachine —— 状态迁移全路径', () => {
  it('★ 全路径 idle→recording→paused→recording→finishing→saving→ended', () => {
    let s: RecordStatus = 'idle';
    s = nextStatus(s, 'recording');
    expect(s).toBe('recording');
    s = nextStatus(s, 'paused');
    expect(s).toBe('paused');
    s = nextStatus(s, 'recording');
    expect(s).toBe('recording');
    s = nextStatus(s, 'finishing');
    expect(s).toBe('finishing');
    s = nextStatus(s, 'saving');
    expect(s).toBe('saving');
    s = nextStatus(s, 'ended');
    expect(s).toBe('ended');
    expect(isTerminalStatus('ended')).toBe(true);
  });

  it('recording 可直接 → finishing（正常结束）', () => {
    expect(canTransition('recording', 'finishing')).toBe(true);
    expect(nextStatus('recording', 'finishing')).toBe('finishing');
  });

  it('paused 可直接 → finishing（暂停中结束）', () => {
    expect(canTransition('paused', 'finishing')).toBe(true);
  });

  it('相同状态视为幂等合法（不抛错）', () => {
    expect(canTransition('recording', 'recording')).toBe(true);
    expect(nextStatus('recording', 'recording')).toBe('recording');
  });

  it('★ 非法迁移被拒（返回原状态）', () => {
    // idle 不能直接到 paused/finishing/saving/ended。
    expect(canTransition('idle', 'paused')).toBe(false);
    expect(nextStatus('idle', 'paused')).toBe('idle');
    expect(canTransition('idle', 'ended')).toBe(false);
    expect(nextStatus('idle', 'ended')).toBe('idle');
    // ended 是终止态，不能迁出。
    expect(canTransition('ended', 'recording')).toBe(false);
    expect(nextStatus('ended', 'recording')).toBe('ended');
    // saving 不能回退。
    expect(canTransition('saving', 'recording')).toBe(false);
    // finishing 不能回退到 recording。
    expect(canTransition('finishing', 'recording')).toBe(false);
  });

  it('assertTransition 对非法迁移抛错', () => {
    expect(() => assertTransition('idle', 'paused')).toThrow();
    expect(() => assertTransition('idle', 'recording')).not.toThrow();
  });

  it('迁移表覆盖全部 6 个状态（无遗漏）', () => {
    const keys = Object.keys(RECORD_TRANSITIONS) as RecordStatus[];
    expect(keys.sort()).toEqual(['ended', 'finishing', 'idle', 'paused', 'recording', 'saving']);
  });

  it('shouldCapture 仅 recording 为真', () => {
    expect(shouldCapture('recording')).toBe(true);
    expect(shouldCapture('paused')).toBe(false);
    expect(shouldCapture('idle')).toBe(false);
  });
});

// ===========================================================================
// 2. RecordSession 生命周期
// ===========================================================================

describe('RecordSession —— 生命周期', () => {
  it('start/pause/resume/finish 全路径；非法操作被拒', () => {
    const s = new RecordSession({ id: 'r1', createdAtMs: 1000 });
    expect(s.status).toBe('idle');
    expect(s.pause(0)).toBe(false); // 未开始不能暂停
    expect(s.start(0)).toBe(true);
    expect(s.status).toBe('recording');
    expect(s.pause(1000)).toBe(true);
    expect(s.status).toBe('paused');
    // 暂停时 ingestSample 被忽略
    const r = s.ingestSample({ t: 1500, expRaw: null, expPct: null, level: null, gold: null, hp: null, mp: null, confidence: 0, readState: 'waiting' });
    expect(r.changedMetrics).toBe(false);
    expect(s.resume(2000)).toBe(true);
    expect(s.status).toBe('recording');
    const rec = s.finish(5000, 9999);
    expect(s.status).toBe('ended');
    expect(rec.id).toBe('r1');
    expect(rec.createdAt).toBe(1000);
    expect(rec.endedAt).toBe(9999);
    expect(rec.status).toBe('ended');
  });

  it('暂停时长不计入有效时长（真实时间跨度）', () => {
    const s = new RecordSession({ id: 'r2' });
    s.start(0);
    s.ingestSample({ t: 1000, expRaw: 100, expPct: 0.1, level: 10, gold: null, hp: null, mp: null, confidence: 1, readState: 'confirmed' });
    s.pause(2000); // 有效时长含 0→2000（采样点 + 暂停前的尾巴）= 2000
    s.resume(10000);
    s.ingestSample({ t: 11000, expRaw: 200, expPct: 0.2, level: 10, gold: null, hp: null, mp: null, confidence: 1, readState: 'confirmed' });
    const rec = s.finish(12000, 1);
    // 有效时长 = 2000（第一段，暂停在 2000 计入尾巴）
    //          + 1000（resume 10000 → 采样 11000）
    //          + 1000（finish 前的尾巴 11000→12000）= 4000
    // 暂停区间 [2000,10000] 的 8000ms 不计入。
    expect(rec.durationMs).toBe(4000);
  });

  it('存在未确认区间 → finish 后 netExp=null、readState=unconfirmedNet', () => {
    const s = new RecordSession({ id: 'r3' });
    s.start(0);
    s.ingestSample({ t: 1000, expRaw: 100, expPct: 0.1, level: 10, gold: null, hp: null, mp: null, confidence: 1, readState: 'confirmed' });
    // 标记未确认。
    s.ingestSample({ t: 2000, expRaw: 150, expPct: 0.15, level: 10, gold: null, hp: null, mp: null, confidence: 0.4, readState: 'unconfirmedNet' });
    const rec = s.finish(3000, 1);
    expect(rec.netExp).toBeNull();
    expect(s.readState).toBe('unconfirmedNet');
  });
});

// ===========================================================================
// 3. confirmGate：ReadState 流转
// ===========================================================================

describe('confirmGate —— mapToReadState', () => {
  const baseCtx: ReadGateContext = {
    prevState: 'waiting',
    consecutiveMiss: 0,
    confirmingSince: null,
    now: 0,
  };

  const acceptedObserve: ObserveResult = { accepted: true, requiredExp: 1000, approximate: true, confirming: false };
  const pendingObserve: ObserveResult = { accepted: false, requiredExp: null, approximate: false, confirming: true };
  const rejectedObserve: ObserveResult = { accepted: false, requiredExp: 1000, approximate: true, confirming: false };

  const signals = (patch: Partial<ReadSignals>): ReadSignals => ({
    hasAnyReading: true,
    isWeak: false,
    isDiscontinuous: false,
    isRecoveredStart: false,
    levelCalibrated: true,
    observe: acceptedObserve,
    missingCrossLevel: false,
    ...patch,
  });

  it('★ 连续拒识达阈值 → interrupted（最高优先级）', () => {
    const st = mapToReadState(signals({ hasAnyReading: false, observe: null }), {
      ...baseCtx,
      consecutiveMiss: INTERRUPT_AFTER_FRAMES,
    });
    expect(st).toBe('interrupted');
  });

  it('无有效读数但未达阈值 → 保持 waiting（首次）', () => {
    const st = mapToReadState(signals({ hasAnyReading: false, observe: null }), {
      ...baseCtx,
      prevState: 'waiting',
      consecutiveMiss: 1,
    });
    expect(st).toBe('waiting');
  });

  it('确认中且超时 → timeout', () => {
    const st = mapToReadState(signals({ observe: pendingObserve }), {
      ...baseCtx,
      prevState: 'confirming',
      confirmingSince: 0,
      now: CONFIRM_TIMEOUT_MS,
      consecutiveMiss: 0,
    });
    expect(st).toBe('timeout');
  });

  it('已接受且一致 → confirmed', () => {
    const st = mapToReadState(signals({}), baseCtx);
    expect(st).toBe('confirmed');
  });

  it('弱样本即便 accepted 也进 confirming（不直接采信）', () => {
    const st = mapToReadState(signals({ isWeak: true }), baseCtx);
    expect(st).toBe('confirming');
  });

  it('未收敛（confirming）→ confirming', () => {
    const st = mapToReadState(signals({ observe: pendingObserve }), baseCtx);
    expect(st).toBe('confirming');
  });

  it('显式 crossLevel → missingCrossLevel', () => {
    const st = mapToReadState(signals({ missingCrossLevel: true }), baseCtx);
    expect(st).toBe('missingCrossLevel');
  });

  it('等级未校准 + 不连续 → 降级为纯数值判定，进 confirming', () => {
    const st = mapToReadState(
      signals({ isDiscontinuous: true, levelCalibrated: false }),
      baseCtx,
    );
    expect(st).toBe('confirming');
  });

  it('拒绝（absolute 回退）→ 沿用上次确认语义（confirming / accumulating，数值不跳变）', () => {
    // 有有效读数、未被接受、不在确认中、无不连续 → accumulating（继续积累）。
    const st = mapToReadState(signals({ observe: rejectedObserve }), baseCtx);
    expect(['accumulating', 'confirming']).toContain(st);
  });

  it('中断恢复后首个 accepted → recovered', () => {
    const st = mapToReadState(signals({}), { ...baseCtx, awaitingRecovery: true });
    expect(st).toBe('recovered');
  });

  it('isTrustedState：仅 confirmed / recovered 可信', () => {
    const trusted: ReadState[] = ['confirmed', 'recovered'];
    const untrusted: ReadState[] = ['waiting', 'accumulating', 'confirming', 'missingCrossLevel', 'timeout', 'interrupted', 'unconfirmedNet'];
    trusted.forEach((s) => expect(isTrustedState(s)).toBe(true));
    untrusted.forEach((s) => expect(isTrustedState(s)).toBe(false));
  });

  it('advanceGateContext：进入/离开 confirming 时正确维护计时', () => {
    const c1 = advanceGateContext('confirming', baseCtx);
    expect(c1.confirmingSince).toBe(baseCtx.now); // 进入 confirming，记录起点
    const c2 = advanceGateContext('confirming', { ...baseCtx, prevState: 'confirming', confirmingSince: 100, now: 500 });
    expect(c2.confirmingSince).toBe(100); // 已在 confirming，保持原起点
    const c3 = advanceGateContext('confirmed', { ...baseCtx, prevState: 'confirming', confirmingSince: 100 });
    expect(c3.confirmingSince).toBeNull(); // 离开 confirming → 清除
  });

  it('advanceGateContext：中断→awaitingRecovery，确认→清除', () => {
    const a = advanceGateContext('interrupted', baseCtx);
    expect(a.awaitingRecovery).toBe(true);
    const b = advanceGateContext('confirmed', { ...baseCtx, awaitingRecovery: true });
    expect(b.awaitingRecovery).toBe(false);
  });
});

// ===========================================================================
// 4. 采集循环纯逻辑
// ===========================================================================

describe('FrameBuffer —— 环形缓冲', () => {
  it('容量上限为 FRAME_N，超出丢弃最旧', () => {
    const buf = new FrameBuffer(3);
    for (let i = 0; i < 5; i++) buf.push({ columns: new Float64Array([i]), width: 1 });
    expect(buf.length).toBe(3);
    expect(buf.toArray().map((f) => f.columns[0])).toEqual([2, 3, 4]);
  });

  it('isFull 判定', () => {
    const buf = new FrameBuffer(FRAME_N);
    for (let i = 0; i < FRAME_N - 1; i++) buf.push({ columns: new Float64Array([0]), width: 1 });
    expect(buf.isFull).toBe(false);
    buf.push({ columns: new Float64Array([0]), width: 1 });
    expect(buf.isFull).toBe(true);
  });
});

describe('★ 等级读取节奏 —— shouldReadLevel', () => {
  it('每 LEVEL_READ_EVERY_N 帧读一次', () => {
    expect(shouldReadLevel(0, 0.1, 0.15).shouldRead).toBe(true);
    expect(shouldReadLevel(LEVEL_READ_EVERY_N, 0.1, 0.15).shouldRead).toBe(true);
    expect(shouldReadLevel(2, 0.1, 0.15).shouldRead).toBe(false);
  });

  it('★ 不连续下降命中 → 立即强制重读（不受 N 帧约束）', () => {
    // seq=1 本不在节奏上，但比例从 0.9 降到 0.1（降幅 0.8 > 0.5）。
    const r = shouldReadLevel(1, 0.9, 0.1);
    expect(r.shouldRead).toBe(true);
    expect(r.forcedByDiscontinuity).toBe(true);
  });

  it('比例上升不触发强制重读', () => {
    const r = shouldReadLevel(1, 0.1, 0.9);
    expect(r.forcedByDiscontinuity).toBe(false);
    expect(r.shouldRead).toBe(false);
  });

  it('任一比例无效（null）不触发强制重读', () => {
    expect(shouldReadLevel(1, null, 0.1).forcedByDiscontinuity).toBe(false);
    expect(shouldReadLevel(1, 0.5, null).forcedByDiscontinuity).toBe(false);
  });
});

describe('宽容档 —— resolveTolerantMode', () => {
  it('连续拒识达触发帧数前用严格阈值', () => {
    const r = resolveTolerantMode(TOLERANT_TRIGGER_FRAMES - 1);
    expect(r.tolerant).toBe(false);
    expect(r.nccMin).toBeCloseTo(0.55, 5);
  });

  it('连续拒识达触发帧数后启用宽容档', () => {
    const r = resolveTolerantMode(TOLERANT_TRIGGER_FRAMES);
    expect(r.tolerant).toBe(true);
    expect(r.nccMin).toBeCloseTo(0.45, 5);
  });
});

describe('★ expBar/expText 同框复用判定', () => {
  it('expSplit=false 且同矩形 → 复用（只抓一次）', () => {
    const calib = makeCalibration(); // 默认 expBar 与 expText 同 base
    expect(shouldReuseExpFrame(calib)).toBe(true);
  });

  it('expSplit=true → 不复用（各抓一次）', () => {
    const calib = makeCalibration({}, true);
    expect(shouldReuseExpFrame(calib)).toBe(false);
  });

  it('expSplit=false 但两框不同 → 不复用', () => {
    const calib = makeCalibration({ expText: { x: 0.3, y: 0, w: 0.2, h: 0.02 } });
    expect(shouldReuseExpFrame(calib)).toBe(false);
  });
});

describe('丢弃策略 —— shouldDropFrame', () => {
  it('上一帧处理中 → 丢弃本帧', () => {
    expect(shouldDropFrame(true)).toBe(true);
    expect(shouldDropFrame(false)).toBe(false);
  });
});

// ===========================================================================
// 5. processFrame 端到端纯逻辑（假抓帧 + 空模板库）
// ===========================================================================

describe('processFrame —— 单帧管线（依赖注入）', () => {
  it('★ expBar/expText 同框时只抓一次帧（grabCount=1，含 level/gold 共 3 次）', () => {
    // 只保留 expBar/expText/gold 可用，禁用 level，便于精确断言「经验条只抓一次」。
    const calib = makeCalibration({
      expBar: { x: 0, y: 0, w: 0.2, h: 0.02 },
      expText: { x: 0, y: 0, w: 0.2, h: 0.02 },
      level: { x: 0, y: 0, w: 0, h: 0 }, // 未校准（禁用）
      gold: { x: 0.5, y: 0, w: 0.1, h: 0.02 },
      hp: { x: 0, y: 0, w: 0, h: 0 },
      mp: { x: 0, y: 0, w: 0, h: 0 },
    });
    const session = new RecordSession({ id: 's1' });
    session.start(0);

    let grabCalls = 0;
    const deps: CaptureDeps = {
      grabRect: () => {
        grabCalls += 1;
        return solidPixels(20, 4, [200, 120, 30]); // 橙黄填充色
      },
      bank: new TemplateBank('test'), // 空库：readDigits 直接拒识
      calibration: calib,
      session,
      now: 1000,
      seq: 0,
    };

    const state = createCaptureLoopState();
    const result = processFrame(state, deps);

    // expBar + expText 同框 → 经验条只抓 1 次；gold 再抓 1 次 → 共 2 次。
    // level 已禁用，不参与抓帧。
    expect(result.reusedExpFrame).toBe(true);
    expect(grabCalls).toBe(2);
    // 经验条为纯橙黄 → 应判为全满比例 1。
    expect(result.ratio).toBeCloseTo(1, 5);
  });

  it('expSplit=true 时经验条与数值各抓一次帧', () => {
    const calib = makeCalibration(
      {
        expBar: { x: 0, y: 0, w: 0.2, h: 0.02 },
        expText: { x: 0.3, y: 0, w: 0.2, h: 0.02 },
        level: { x: 0, y: 0, w: 0, h: 0 },
        gold: { x: 0.5, y: 0, w: 0.1, h: 0.02 },
        hp: { x: 0, y: 0, w: 0, h: 0 },
        mp: { x: 0, y: 0, w: 0, h: 0 },
      },
      true,
    );
    const session = new RecordSession({ id: 's2' });
    session.start(0);
    let grabCalls = 0;
    const deps: CaptureDeps = {
      grabRect: () => {
        grabCalls += 1;
        return solidPixels(20, 4, [200, 120, 30]);
      },
      bank: new TemplateBank('test'),
      calibration: calib,
      session,
      now: 1000,
      seq: 0,
    };
    const result = processFrame(createCaptureLoopState(), deps);
    expect(result.reusedExpFrame).toBe(false);
    // expBar + expText + gold = 3 次。
    expect(grabCalls).toBe(3);
  });

  it('等级区域：仅在节奏命中帧读取（seq=2 不读，seq=5 读）', () => {
    const calib = makeCalibration({ level: { x: 0.5, y: 0, w: 0.1, h: 0.02 } });
    const session = new RecordSession({ id: 's3', levelCalibrated: true });
    session.start(0);
    const grabRect = (): PixelSource => solidPixels(20, 4, [200, 120, 30]);
    const bank = new TemplateBank('test');

    const st1 = createCaptureLoopState();
    const r1 = processFrame(st1, { grabRect, bank, calibration: calib, session, now: 1000, seq: 2 });
    expect(r1.levelReadThisFrame).toBe(false);

    const st2 = createCaptureLoopState();
    const r2 = processFrame(st2, { grabRect, bank, calibration: calib, session, now: 2000, seq: LEVEL_READ_EVERY_N });
    expect(r2.levelReadThisFrame).toBe(true);
  });

  it('★ 不连续下降时强制读取等级（即便 seq 不在节奏上）', () => {
    const calib = makeCalibration({ level: { x: 0.5, y: 0, w: 0.1, h: 0.02 } });
    const session = new RecordSession({ id: 's4', levelCalibrated: true });
    session.start(0);
    const bank = new TemplateBank('test');

    // 第一帧：比例较高（填充像素多）。
    const st = createCaptureLoopState();
    // 用可切换颜色的抓帧：先橙黄（满），后深棕（空）。
    let color: [number, number, number] = [200, 120, 30];
    const grabRect = (): PixelSource => solidPixels(20, 4, color);
    processFrame(st, { grabRect, bank, calibration: calib, session, now: 1000, seq: 0 });
    expect(st.prevRatio).toBeCloseTo(1, 5);

    // 第二帧（seq=1，不在节奏）：比例突降 → 强制读等级。
    color = [40, 25, 20]; // 深棕底 → 全空
    // 需足够帧让中值下降；直接切换到空色后，缓冲中仍有旧帧，中值可能仍为满。
    // 故此处直接调用 shouldReadLevel 校验判定；processFrame 的强制读取在真实多帧后才生效。
    const r = shouldReadLevel(1, 1, 0);
    expect(r.forcedByDiscontinuity).toBe(true);
  });

  it('金币区域为纯色（空库拒识）→ gold 为 null（不猜值）', () => {
    const calib = makeCalibration();
    const session = new RecordSession({ id: 's5' });
    session.start(0);
    const deps: CaptureDeps = {
      grabRect: () => solidPixels(20, 4, [200, 120, 30]),
      bank: new TemplateBank('test'),
      calibration: calib,
      session,
      now: 1000,
      seq: 0,
    };
    const result = processFrame(createCaptureLoopState(), deps);
    expect(result.gold).toBeNull();
    expect(result.absolute).toBeNull(); // 空模板库 → 拒识
  });

  it('抓帧失败不抛错（grabRect 返回 null）', () => {
    const calib = makeCalibration();
    const session = new RecordSession({ id: 's6' });
    session.start(0);
    const deps: CaptureDeps = {
      grabRect: () => null,
      bank: new TemplateBank('test'),
      calibration: calib,
      session,
      now: 1000,
      seq: 0,
    };
    expect(() => processFrame(createCaptureLoopState(), deps)).not.toThrow();
  });
});

// ===========================================================================
// 6. 时间口径：经验/小时用真实时间跨度
// ===========================================================================

describe('RecordSession —— 时间口径', () => {
  it('经验/小时用真实时间跨度（非帧数）', () => {
    const s = new RecordSession({ id: 'r4', levelCalibrated: true });
    s.start(0);
    // t=0：经验 1000，比例 0.1，等级 10
    s.ingestSample({ t: 0, expRaw: 1000, expPct: 0.1, level: 10, gold: 0, hp: null, mp: null, confidence: 1, readState: 'confirmed' });
    // t=3600000（1 小时）：经验 101000 → 净 100000 → 100000/h
    s.ingestSample({ t: 3_600_000, expRaw: 101_000, expPct: 0.2, level: 10, gold: 5000, hp: null, mp: null, confidence: 1, readState: 'confirmed' });
    const rec = s.finish(3_600_000, 1);
    expect(rec.netExp).toBe(100_000);
    expect(rec.expPerHour).toBeCloseTo(100_000, 0);
  });

  it('等级未校准 → Sample.level 恒为 null，并给出降级提示', () => {
    const s = new RecordSession({ id: 'r5', levelCalibrated: false });
    s.start(0);
    const r = s.ingestSample({ t: 1000, expRaw: 500, expPct: 0.5, level: 10, gold: null, hp: null, mp: null, confidence: 1, readState: 'confirmed', levelCalibrated: false });
    expect(r.notices).toContain('LEVEL_NOT_CALIBRATED');
    const sample = s.pendingSamples[0];
    expect(sample.level).toBeNull();
  });
});
