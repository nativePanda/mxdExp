/**
 * 「复制诊断信息」组装工具。
 *
 * 用于用户反馈问题时提供环境快照（不含任何隐私数据，仅环境参数）。
 */

import { SCHEMA_VERSION } from '@/types/models';
import type { DiagnosticPayload } from '@/types/ipc';
import { screenKeyFromBrowser } from './screenKey';

/** 应用版本号（与 package.json 保持一致；构建期可由 Vite define 注入）。 */
export const APP_VERSION = '0.1.0';

/** 收集诊断信息的入参。 */
export interface CollectDiagInput {
  /** 画面原始宽度（px）；未知传 0。 */
  width: number;
  /** 画面原始高度（px）；未知传 0。 */
  height: number;
  /** 当前性能档位。 */
  perfTier: string;
  /** 当前采集频率（次/秒）。 */
  captureFps: number;
  /** 当前画面检查频率（次/秒）。 */
  checkFps: number;
}

/**
 * 收集当前环境的诊断信息快照。
 *
 * @param input 环境参数。
 * @param now 生成时间戳，默认当前时间。
 * @returns 诊断信息载荷。
 */
export function collectDiagnostics(
  input: CollectDiagInput,
  now: number = Date.now(),
): DiagnosticPayload {
  const ua = typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : '';
  const dpr =
    typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
      ? window.devicePixelRatio
      : 1;
  return {
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    ua,
    width: input.width,
    height: input.height,
    devicePixelRatio: dpr,
    screenKey: screenKeyFromBrowser(input.width, input.height),
    perfTier: input.perfTier,
    captureFps: input.captureFps,
    checkFps: input.checkFps,
    generatedAt: now,
  };
}

/**
 * 把诊断信息格式化为人类可读的多行文本（供复制到剪贴板）。
 *
 * @param payload 诊断信息载荷。
 * @returns 多行文本。
 */
export function formatDiagnostics(payload: DiagnosticPayload): string {
  const lines: string[] = [
    '=== 经验记录 诊断信息 ===',
    `应用版本: ${payload.appVersion}`,
    `数据模型版本: v${payload.schemaVersion}`,
    `画面尺寸: ${payload.width} x ${payload.height}`,
    `设备像素比: ${payload.devicePixelRatio}`,
    `screenKey: ${payload.screenKey}`,
    `性能档位: ${payload.perfTier}`,
    `采集频率: ${payload.captureFps} 次/秒`,
    `画面检查频率: ${payload.checkFps} 次/秒`,
    `生成时间: ${new Date(payload.generatedAt).toISOString()}`,
    `UA: ${payload.ua}`,
    '=== 以上信息不含任何隐私数据 ===',
  ];
  return lines.join('\n');
}
