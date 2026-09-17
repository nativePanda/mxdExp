/**
 * recognize.worker —— 重识别任务承接（**P0 仅保留接口，不启用**）。
 *
 * 依据：架构文档 §2.9（「P0 可先不启用，保留接口」）+ §5.6（Worker 协议）。
 *
 * ## P0 决策：保留接口，不实现识别逻辑
 *
 * 预研实测：主线程同步识别单帧 < 5ms（模板匹配），1Hz 采集下完全够用，
 * 因此 **P0 不把识别搬到 Worker**（避免 `ImageBitmap` 传输复杂度与在途帧积压）。
 * 本文件只定义「将来若要卸载主线程识别负载」时的消息契约与骨架，
 * 具体识别逻辑留空（不 import vision 内核，避免 P0 打包体积与复杂度）。
 *
 * ## 协议（未来启用时的约定，非 P0 生效）
 * - 主线程 → 本 Worker：`RecognizeRequest`（携带 `ImageBitmap` + rect + bank 快照）；
 * - 本 Worker → 主线程：`RecognizeResponse`（识别结果或拒识）。
 *
 * 说明：`ImageBitmap` 为 transferable，主线程 `postMessage(request, [bitmap])` 转移所有权，
 * 避免拷贝；Worker 侧识别完 `bitmap.close()` 释放。
 */

import type { RegionRect } from '@/types/calibration';
import type { SerializedTemplateBank } from '@/types/vision';
import type { ReadState } from '@/types/enums';

/** 识别任务类型：经验数值 / 等级 / 金币 / HP / MP。 */
export type RecognizeKind = 'expText' | 'level' | 'gold' | 'hp' | 'mp';

/**
 * 主线程 → recognize.worker 的请求。
 *
 * ⚠️ P0 不构造/不发送本消息；仅为接口预留。
 */
export interface RecognizeRequest {
  type: 'recognize';
  /** 请求序号（配对响应用）。 */
  id: number;
  /** 任务类型。 */
  kind: RecognizeKind;
  /** 待识别位图（transferable）。 */
  bitmap: ImageBitmap;
  /** 区域（归一化坐标，相对该位图尺寸）。 */
  rect: RegionRect;
  /** 字形模板库快照（序列化形式，便于结构化克隆）。 */
  bank: SerializedTemplateBank;
  /** 是否为宽容档（连续拒识降级）。 */
  tolerant?: boolean;
}

/** recognize.worker → 主线程的响应。 */
export interface RecognizeResponse {
  type: 'recognized';
  /** 与请求配对的序号。 */
  id: number;
  /** 识别数值；**拒识为 `null`**（绝不返回猜测值）。 */
  value: number | null;
  /** 原始识别文本；拒识为 `null`。 */
  text: string | null;
  /** 置信度 0–1。 */
  confidence: number;
  /** 该次识别的读数状态（供确认门参考）。 */
  readState: ReadState;
}

/** 本 Worker 收发的消息联合类型。 */
export type RecognizeInMessage = RecognizeRequest;
/** 本 Worker 回传的消息联合类型。 */
export type RecognizeOutMessage = RecognizeResponse;

/**
 * 处理一条识别请求。
 *
 * ⚠️ **P0 未实现**：本函数不执行任何识别，仅释放位图并回传一个显式的「拒识」响应，
 * 以保证接口契约完整、可被未来替换为真实实现。P0 采集管线**不走本 Worker**。
 *
 * @param request 识别请求。
 * @returns 识别响应（P0 恒为拒识）。
 */
export function handleRecognizeRequest(request: RecognizeRequest): RecognizeResponse {
  // 释放位图（避免内存泄漏）；P0 不使用位图内容。
  try {
    request.bitmap.close();
  } catch {
    // 某些环境可能不支持 close；忽略。
  }
  return {
    type: 'recognized',
    id: request.id,
    value: null,
    text: null,
    confidence: 0,
    readState: 'confirming',
  };
}

/**
 * Worker 全局作用域的最小类型。
 */
interface RecognizeScope {
  postMessage(message: RecognizeOutMessage): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

/**
 * 判断一条消息是否为 `RecognizeRequest`。
 *
 * @param message 待判定消息。
 * @returns 是否为识别请求。
 */
function isRecognizeRequest(message: unknown): message is RecognizeRequest {
  if (typeof message !== 'object' || message === null) return false;
  return (message as { type?: unknown }).type === 'recognize';
}

const scope = self as unknown as RecognizeScope;

scope.addEventListener('message', (event: { data: unknown }) => {
  if (!isRecognizeRequest(event.data)) return;
  scope.postMessage(handleRecognizeRequest(event.data));
});
