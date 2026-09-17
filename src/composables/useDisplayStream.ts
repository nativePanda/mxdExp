/**
 * `useDisplayStream` —— `getDisplayMedia` 封装（共享游戏窗口）。
 *
 * 依据：架构文档 §2.12 / §4.1（初始化时序）+ §5.1（归一化坐标）。
 *
 * 职责：
 * - 请求屏幕/窗口共享流（`video` track）；
 * - 装配 offscreen `<video>` 元素并等待其可播放（`loadedmetadata` / `play`）；
 * - 监听 `track.onended`（用户停止共享 / 窗口关闭）→ 通知外层；
 * - 暴露 `disconnect()` 释放资源。
 *
 * ⚠️ 依赖浏览器 API（`navigator.mediaDevices` / `HTMLVideoElement`），
 * 在 Node 下无法真实运行。因此本模块**只做薄封装**：所有可测的纯逻辑
 * （尺寸获取、轨道结束判定、状态派生）都抽成下方独立导出函数，便于在 jsdom/Node 下测。
 */

import { ref, shallowRef, computed, onBeforeUnmount, type Ref, type ComputedRef } from 'vue';

/** 共享流的状态机。 */
export type StreamPhase = 'idle' | 'requesting' | 'connected' | 'error';

/** 共享流的尺寸信息（`videoWidth/videoHeight` 就绪后才有值）。 */
export interface StreamDimensions {
  /** 画面原始宽度（px）。 */
  width: number;
  /** 画面原始高度（px）。 */
  height: number;
}

/** `useDisplayStream` 的返回。 */
export interface UseDisplayStream {
  /** 当前共享流。 */
  stream: Ref<MediaStream | null>;
  /** 承载画面的 video 元素（离屏、`muted`、`playsInline`）。 */
  video: Ref<HTMLVideoElement | null>;
  /** 流状态。 */
  phase: Ref<StreamPhase>;
  /** 是否已连接（尺寸就绪）。 */
  connected: ComputedRef<boolean>;
  /** 画面尺寸（未就绪为 `{width:0,height:0}`）。 */
  dimensions: Ref<StreamDimensions>;
  /** 上次错误信息（无错误为 `null`）。 */
  error: Ref<string | null>;
  /** 用户或系统结束共享时置为 `true`（供 UI 提示「请重新选择窗口」）。 */
  endedByUser: Ref<boolean>;
  /** 请求共享（浏览器需用户手势触发）。 */
  connect: () => Promise<boolean>;
  /** 断开并释放资源。 */
  disconnect: () => void;
}

/** `getDisplayMedia` 的约束（优先请求视频，帧率不设死以兼容低配）。 */
export const DEFAULT_DISPLAY_CONSTRAINTS: DisplayMediaStreamOptions = {
  video: {
    frameRate: { ideal: 30 },
  },
  audio: false,
};

/**
 * 从 video 元素读取画面尺寸；未就绪时返回 `{width:0,height:0}`。
 *
 * 纯函数（只读 `videoWidth/videoHeight`），便于单测。
 *
 * @param video video 元素或 `null`。
 * @returns 尺寸信息。
 */
export function readVideoDimensions(video: HTMLVideoElement | null): StreamDimensions {
  if (!video) return { width: 0, height: 0 };
  const width = Number.isFinite(video.videoWidth) ? video.videoWidth : 0;
  const height = Number.isFinite(video.videoHeight) ? video.videoHeight : 0;
  return { width, height };
}

/**
 * 判断流是否包含可用的 video track。
 *
 * @param stream 媒体流或 `null`。
 * @returns 是否含 video track。
 */
export function hasVideoTrack(stream: MediaStream | null): boolean {
  if (!stream) return false;
  return stream.getVideoTracks().length > 0;
}

/**
 * 判断 video 元素是否已具备可用尺寸。
 *
 * @param video video 元素或 `null`。
 * @returns 是否尺寸就绪。
 */
export function isVideoReady(video: HTMLVideoElement | null): boolean {
  if (!video) return false;
  return video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2;
}

/**
 * 创建一个 `useDisplayStream` 实例（需在组件 `setup` 或等效作用域内调用）。
 *
 * @param opts 可选参数（自定义约束、自动断开）。
 * @returns `UseDisplayStream`。
 */
export function useDisplayStream(opts: {
  /** 是否在组件卸载时自动断开，默认 `true`。 */
  autoDisconnectOnUnmount?: boolean;
} = {}): UseDisplayStream {
  const autoDisconnect = opts.autoDisconnectOnUnmount ?? true;

  const stream = shallowRef<MediaStream | null>(null);
  const video = shallowRef<HTMLVideoElement | null>(null);
  const phase = ref<StreamPhase>('idle');
  const dimensions = ref<StreamDimensions>({ width: 0, height: 0 });
  const error = ref<string | null>(null);
  const endedByUser = ref(false);

  const connected = computed(
    () => phase.value === 'connected' && dimensions.value.width > 0 && dimensions.value.height > 0,
  );

  // 监听 track 结束（用户停止共享）。
  const handleTrackEnded = (): void => {
    endedByUser.value = true;
    phase.value = 'idle';
    dimensions.value = { width: 0, height: 0 };
  };

  /**
   * 读取当前流状态。
   *
   * 说明：`connect()` 内部跨越多个 `await` 边界，TypeScript 会把 `phase.value`
   * 窄化为 `'requesting'`（忽略 `markReady()` 这类闭包内的赋值），从而在
   * `phase.value !== 'connected'` 处报 TS2367 假阳性。通过本函数读取可让窄化失效，
   * **不改变任何运行时行为**。
   *
   * @returns 当前流状态。
   */
  const readPhase = (): StreamPhase => phase.value;

  /**
   * 更新尺寸并标记为已连接。
   */
  const markReady = (): void => {
    const dims = readVideoDimensions(video.value);
    if (dims.width > 0 && dims.height > 0) {
      dimensions.value = dims;
      phase.value = 'connected';
    }
  };

  /**
   * 请求共享画面。
   *
   * @returns 是否成功连接。
   */
  const connect = async (): Promise<boolean> => {
    endedByUser.value = false;
    error.value = null;

    const mediaDevices =
      typeof navigator !== 'undefined' && navigator.mediaDevices
        ? navigator.mediaDevices
        : null;
    if (!mediaDevices || typeof mediaDevices.getDisplayMedia !== 'function') {
      phase.value = 'error';
      error.value = '当前浏览器不支持屏幕共享（需要 http://localhost 安全上下文）';
      return false;
    }

    phase.value = 'requesting';
    try {
      const media = await mediaDevices.getDisplayMedia(DEFAULT_DISPLAY_CONSTRAINTS);
      if (!hasVideoTrack(media)) {
        media.getTracks().forEach((t) => t.stop());
        phase.value = 'error';
        error.value = '所选画面不包含视频轨道';
        return false;
      }

      stream.value = media;

      // 装配离屏 video。
      const el = typeof document !== 'undefined' ? document.createElement('video') : null;
      if (!el) {
        phase.value = 'error';
        error.value = '无法创建 video 元素';
        return false;
      }
      el.muted = true;
      el.playsInline = true;
      el.autoplay = true;
      el.srcObject = media;

      // track 结束监听。
      media.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', handleTrackEnded);
      });

      // 等待元数据 → 播放 → 读尺寸。
      await new Promise<void>((resolve) => {
        const onLoaded = (): void => {
          el.removeEventListener('loadedmetadata', onLoaded);
          resolve();
        };
        el.addEventListener('loadedmetadata', onLoaded);
        // 兜底：已有元数据时立即 resolve。
        if (el.readyState >= 1) {
          el.removeEventListener('loadedmetadata', onLoaded);
          resolve();
        }
      });

      try {
        await el.play();
      } catch {
        // 自动播放被拒（无用户手势）时不致命，尺寸仍可用。
      }

      video.value = el;
      markReady();

      // 尺寸可能延迟就绪 → 再试一次。
      if (readPhase() !== 'connected') {
        await new Promise<void>((resolve) => {
          const onLoaded = (): void => {
            el.removeEventListener('loadeddata', onLoaded);
            resolve();
          };
          el.addEventListener('loadeddata', onLoaded);
          setTimeout(() => {
            el.removeEventListener('loadeddata', onLoaded);
            resolve();
          }, 500);
        });
        markReady();
      }

      if (readPhase() !== 'connected') {
        phase.value = 'error';
        error.value = '画面尺寸尚未就绪';
        return false;
      }
      return true;
    } catch (err) {
      phase.value = 'error';
      error.value = err instanceof Error ? err.message : '请求共享画面失败';
      return false;
    }
  };

  /**
   * 断开并释放资源（停止所有轨道、清空 video）。
   */
  const disconnect = (): void => {
    const media = stream.value;
    if (media) {
      media.getVideoTracks().forEach((track) => {
        track.removeEventListener('ended', handleTrackEnded);
        track.stop();
      });
      media.getTracks().forEach((t) => {
        if (t.readyState !== 'ended') t.stop();
      });
    }
    const el = video.value;
    if (el) {
      el.srcObject = null;
    }
    stream.value = null;
    video.value = null;
    dimensions.value = { width: 0, height: 0 };
    if (phase.value !== 'error') phase.value = 'idle';
  };

  if (autoDisconnect && typeof onBeforeUnmount === 'function') {
    onBeforeUnmount(disconnect);
  }

  return {
    stream,
    video,
    phase,
    connected,
    dimensions,
    error,
    endedByUser,
    connect,
    disconnect,
  };
}
