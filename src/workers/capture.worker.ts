/**
 * capture.worker —— 采集驱动（定时器 + 抗后台节流）。
 *
 * 依据：架构文档 §2.9 / §5.6（Worker 协议）+ 预研 tech-probe §5（采集与调度）。
 *
 * ## 为什么必须是 Worker 定时器（预研实测结论，勿改）
 * - `requestAnimationFrame` 在后台标签页 = **0 帧**（完全停摆）→ 绝不能用 rAF 驱动采集；
 * - 主线程 `setInterval`：前 5 分钟保持 ~1Hz，**隐藏超过 5 分钟会塌到 1 次/分钟**；
 * - **Web Worker 定时器按规范豁免后台节流** → 唯一正确的采集驱动。
 *
 * ## 协议（`types/messages.ts`）
 * - 收 `{type:'start';fps}` / `{type:'stop'}` / `{type:'setFps';fps}`；
 * - 发 `{type:'started';fps}` / `{type:'tick';t;seq}` / `{type:'stopped'}`。
 *
 * Worker **不碰 DOM、不碰 store**，只发 tick。节奏由 `fps` 决定（`setInterval(1000/fps)`）；
 * `setFps` 重建定时器。主线程收到 tick 后同步抓帧，未处理完则丢弃本帧（不排队）。
 *
 * 纯 TS，无 Vue/DOM 依赖；仅依赖 `types/messages` 与 `constants` 中的纯函数。
 */

import type { MainToWorker, WorkerToMain } from '@/types/messages';
import { fpsToIntervalMs, isMainToWorker } from '@/types/messages';
import { clampFps } from '@/constants/perf';

/** Worker 全局作用域的最小类型（避免依赖 `lib.webworker` 的具体命名）。 */
interface WorkerScope {
  postMessage(message: WorkerToMain): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

/** 采集定时器句柄（`ReturnType<typeof setInterval>` 兼容各环境）。 */
let timer: ReturnType<typeof setInterval> | null = null;

/** 当前生效频率（次/秒）；未启动为 `0`。 */
let currentFps = 0;

/** 自开始以来的节拍序号（从 0 递增）。 */
let seq = 0;

/** Worker 侧起始时刻（用于 tick 的 `t` 字段；主线程应以自身时钟为准）。 */
let startedAt = 0;

/** Worker 全局作用域引用（`self` 的窄化别名）。 */
const scope = self as unknown as WorkerScope;

/**
 * 清空现有定时器（若有）。
 */
function clearTimer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * 建立定时器：按 `fps` 周期性发送 `tick`。
 *
 * @param fps 频率（次/秒）。
 */
function schedule(fps: number): void {
  clearTimer();
  const interval = fpsToIntervalMs(fps);
  timer = setInterval(() => {
    const t = typeof performance !== 'undefined' ? performance.now() - startedAt : seq * interval;
    const message: WorkerToMain = { type: 'tick', t, seq };
    seq += 1;
    scope.postMessage(message);
  }, interval);
}

/**
 * 处理 `start`：重置序号与起始时刻（若未启动），按 `fps` 建立定时器。
 *
 * @param fps 期望频率。
 */
function handleStart(fps: number): void {
  const safeFps = clampFps(fps);
  // 仅首次启动时重置 seq/startedAt；重复 start 视为重启节奏。
  seq = 0;
  startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  currentFps = safeFps;
  schedule(safeFps);
  scope.postMessage({ type: 'started', fps: safeFps });
}

/**
 * 处理 `stop`：清空定时器并回执。
 */
function handleStop(): void {
  clearTimer();
  currentFps = 0;
  scope.postMessage({ type: 'stopped' });
}

/**
 * 处理 `setFps`：仅当已启动时按新频率重建定时器。
 *
 * @param fps 新频率。
 */
function handleSetFps(fps: number): void {
  const safeFps = clampFps(fps);
  currentFps = safeFps;
  if (timer !== null) {
    // 已启动 → 重建定时器（序号继续递增，不重置）。
    schedule(safeFps);
  }
  scope.postMessage({ type: 'started', fps: safeFps });
}

/**
 * 消息入口：解析并分派主线程指令。
 *
 * @param event Worker message 事件。
 */
function onMessage(event: { data: unknown }): void {
  const data = event.data;
  if (!isMainToWorker(data)) return;
  const message = data as MainToWorker;
  switch (message.type) {
    case 'start':
      handleStart(message.fps);
      break;
    case 'stop':
      handleStop();
      break;
    case 'setFps':
      handleSetFps(message.fps);
      break;
    default:
      break;
  }
}

scope.addEventListener('message', onMessage);

/**
 * 供测试读取当前频率（不参与协议，仅导出便于单测断言；浏览器构建中无副作用）。
 */
export function __getCurrentFps(): number {
  return currentFps;
}
