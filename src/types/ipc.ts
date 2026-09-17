/**
 * IPC / 跨模块载荷类型（架构文档 §2.3）。
 *
 * 本项目为纯前端应用，无真正的主进程-渲染进程 IPC；
 * 这里的 `ipc.ts` 承载「跨模块/跨线程交互载荷」的类型定义，
 * 例如采集请求、采集响应、抓帧结果等。
 */

import type { PixelSource } from './vision';
import type { RegionRect } from './calibration';

// ---------------------------------------------------------------------------
// 采集请求 / 响应
// ---------------------------------------------------------------------------

/** 一次抓帧请求（归一化坐标）。 */
export interface CaptureRequest {
  /** 目标区域（归一化 0–1）；为 `null` 表示抓取整幅画面。 */
  rect: RegionRect | null;
  /** 请求发起时刻（ms，`performance.now()`）。 */
  requestedAt: number;
}

/** 一次抓帧响应（成功）。 */
export interface CaptureResponse {
  /** 是否成功抓帧。 */
  ok: boolean;
  /** 抓到的像素源；失败为 `null`。 */
  frame: PixelSource | null;
  /** 该帧对应的原始视频宽度（px）。 */
  sourceWidth: number;
  /** 该帧对应的原始视频高度（px）。 */
  sourceHeight: number;
  /** 响应时刻（ms，`performance.now()`）。 */
  receivedAt: number;
  /** 失败原因（`ok=false` 时有值）。 */
  error: string | null;
}

// ---------------------------------------------------------------------------
// 诊断信息（「复制诊断信息」功能载荷）
// ---------------------------------------------------------------------------

/** 诊断信息快照（供用户复制反馈问题）。 */
export interface DiagnosticPayload {
  /** 应用版本号。 */
  appVersion: string;
  /** 数据模型版本号。 */
  schemaVersion: number;
  /** 浏览器 UA。 */
  ua: string;
  /** 画面原始宽度（px）。 */
  width: number;
  /** 画面原始高度（px）。 */
  height: number;
  /** 设备像素比。 */
  devicePixelRatio: number;
  /** 屏幕像素比指纹（`screenKey`）。 */
  screenKey: string;
  /** 当前性能档位。 */
  perfTier: string;
  /** 当前采集频率（次/秒）。 */
  captureFps: number;
  /** 当前画面检查频率（次/秒）。 */
  checkFps: number;
  /** 生成时间戳（`Date.now()`）。 */
  generatedAt: number;
}
