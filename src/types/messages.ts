/**
 * Worker ↔ 主线程消息协议（架构文档 §5.6）。
 *
 * 硬约定：
 * - Worker **不碰 DOM、不碰 store**，只发 tick。
 * - 节奏由 `fps` 决定：`setInterval(1000/fps)`；`setFps` 重建定时器。
 * - 主线程收到 tick 后**同步**抓帧；若上一帧未处理完则**跳过本帧**。
 * - Worker 里用 `setInterval`（规范豁免后台节流），**绝不用 rAF**。
 */

// ---------------------------------------------------------------------------
// 主线程 → capture.worker
// ---------------------------------------------------------------------------

/** 开始采集（按 `fps` 发 tick）。 */
export interface WorkerStartMessage {
  type: 'start';
  /** 期望采样频率（次/秒）。 */
  fps: number;
}

/** 停止采集。 */
export interface WorkerStopMessage {
  type: 'stop';
}

/** 动态调整采样频率（重建定时器）。 */
export interface WorkerSetFpsMessage {
  type: 'setFps';
  /** 新的采样频率（次/秒）。 */
  fps: number;
}

/** 主线程 → capture.worker 的消息联合类型。 */
export type MainToWorker = WorkerStartMessage | WorkerStopMessage | WorkerSetFpsMessage;

// ---------------------------------------------------------------------------
// capture.worker → 主线程
// ---------------------------------------------------------------------------

/** 一次采样节拍。 */
export interface WorkerTickMessage {
  type: 'tick';
  /** Worker 侧的相对时刻（ms）；主线程应以自身 `performance.now()` 为准。 */
  t: number;
  /** 自开始以来的节拍序号（从 0 递增）。 */
  seq: number;
}

/** 采集已启动的确认。 */
export interface WorkerStartedMessage {
  type: 'started';
  /** 实际生效的频率（次/秒）。 */
  fps: number;
}

/** 采集已停止的确认。 */
export interface WorkerStoppedMessage {
  type: 'stopped';
}

/** capture.worker → 主线程的消息联合类型。 */
export type WorkerToMain = WorkerTickMessage | WorkerStartedMessage | WorkerStoppedMessage;

// ---------------------------------------------------------------------------
// 类型守卫（便于 worker 与主线程安全解析消息）
// ---------------------------------------------------------------------------

/**
 * 判断一条消息是否为 `MainToWorker` 协议消息。
 *
 * @param message 待判定的消息。
 * @returns 是否为合法的主线程→Worker 消息。
 */
export function isMainToWorker(message: unknown): message is MainToWorker {
  if (typeof message !== 'object' || message === null) return false;
  const type = (message as { type?: unknown }).type;
  return type === 'start' || type === 'stop' || type === 'setFps';
}

/**
 * 判断一条消息是否为 `WorkerToMain` 协议消息。
 *
 * @param message 待判定的消息。
 * @returns 是否为合法的 Worker→主线程消息。
 */
export function isWorkerToMain(message: unknown): message is WorkerToMain {
  if (typeof message !== 'object' || message === null) return false;
  const type = (message as { type?: unknown }).type;
  return type === 'tick' || type === 'started' || type === 'stopped';
}

/**
 * 根据频率计算定时器间隔（ms）；频率非法时按 1Hz 兜底。
 *
 * @param fps 频率（次/秒）。
 * @returns 定时器间隔（ms）。
 */
export function fpsToIntervalMs(fps: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 1;
  return Math.max(1, Math.round(1000 / safeFps));
}
