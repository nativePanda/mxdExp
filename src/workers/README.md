# `src/workers/` —— Worker 与主线程协议

> 与 `src/types/messages.ts` 对齐。硬约定见架构文档 §5.6；调度依据见预研报告 §5。

## 1. 为什么需要 Worker 定时器（不可更改的预研实测结论）

浏览器后台节流（Chrome 88+）实测数据：

| 定时器 | 前台 | 后台标签页 | 后台最后 10s |
|--------|------|-----------|-------------|
| `requestAnimationFrame` | ~61Hz | **0 次**（完全停摆） | **0 次** |
| 主线程 `setInterval(1000)` | 1Hz | ~1Hz | 1 次/分钟（隐藏 >5 分钟后） |
| **Worker `setInterval(1000)`** | 1Hz | ~1Hz | **~1Hz**（规范豁免） |

**结论**：
- 绝不能用 `requestAnimationFrame` 驱动采集；
- 采集驱动必须是 **`capture.worker` 里的 `setInterval`**（Worker 定时器按规范豁免后台节流），
  主线程监听 tick 后同步抓帧；
- 速率一律用**真实时间跨度** `deltaExp / deltaMs` 计算，**绝不用帧数**（后台掉帧会算错）。

## 2. `capture.worker.ts` 协议

**主线程 → worker**（`MainToWorker`，定义于 `src/types/messages.ts`）：

```ts
type MainToWorker =
  | { type: 'start';  fps: number }   // 按 fps 开始发 tick
  | { type: 'stop' }                  // 停止
  | { type: 'setFps'; fps: number };  // 调整频率（重建定时器）
```

**worker → 主线程**（`WorkerToMain`）：

```ts
type WorkerToMain =
  | { type: 'tick';    t: number; seq: number } // 采样节拍
  | { type: 'started'; fps: number }            // 已启动确认
  | { type: 'stopped' };                        // 已停止确认
```

**约定**：
- Worker **不碰 DOM、不碰 store**，只发 `tick`；
- 节奏 `setInterval(1000/fps)`；`fps` 经 `clampFps`（`constants/perf.ts`）约束到 `[0.25, 10]`；
- `setFps` 重建定时器，`seq` 继续递增（不重置）；
- 主线程收到 tick 后**同步**抓帧；若上一帧未处理完则**丢弃本帧**（不排队，避免积压）；
- `tick.t` 为 Worker 侧相对时刻，主线程应以自身 `performance.now()` 为准
  （见架构 §5.2：避免跨线程时钟差）。

`tick` 的 `seq` 从 0 递增，用于主线程判定「等级区域是否该读」（每 `LEVEL_READ_EVERY_N` 帧）。

## 3. `recognize.worker.ts`（P0 仅保留接口）

P0 **不启用**：预研实测主线程同步识别单帧 < 5ms，1Hz 采集下完全够用。
本文件只定义未来把识别卸载到 Worker 时的消息契约（`RecognizeRequest` /
`RecognizeResponse`，携带 `ImageBitmap` transferable + `SerializedTemplateBank` 快照），
`handleRecognizeRequest` 在 P0 返回显式「拒识」以保证接口完整。P0 采集管线**不走本 Worker**。

## 4. 时间基准提醒

- 全局统一 `t = performance.now() - recordStartedAt`（ms，相对记录起点）；
- `Sample.t` / `Segment.startT/endT` / `LevelUpEvent.t` 都是这个 `t`；
- `Record.createdAt/endedAt` 用 `Date.now()`（绝对时间，历史展示用）；
- Worker 只负责「该采样了」，具体时间以主线程收到 tick 时的 `performance.now()` 为准。
