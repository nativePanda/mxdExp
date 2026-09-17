/**
 * StreamStore —— 共享流状态（`MediaStream` / video 元素 / 尺寸 / 连接态）。
 *
 * 依据：架构文档 §2.11 / §3.6 + §4.1（初始化时序）。
 *
 * 说明：本 store 只持有**状态**，实际 `getDisplayMedia` 调用由 `useDisplayStream`
 * 组合式完成并把结果写入本 store（保持 store 与浏览器 API 解耦，便于测试）。
 */

import { defineStore } from 'pinia';
import { ref, computed, shallowRef } from 'vue';
import type { StreamPhase, StreamDimensions } from '@/composables/useDisplayStream';

/**
 * 共享流 store（setup 风格）。
 */
export const useStreamStore = defineStore('stream', () => {
  /** 当前共享流。 */
  const stream = shallowRef<MediaStream | null>(null);

  /** 承载画面的 video 元素。 */
  const video = shallowRef<HTMLVideoElement | null>(null);

  /** 流状态机。 */
  const phase = ref<StreamPhase>('idle');

  /** 画面尺寸。 */
  const dimensions = ref<StreamDimensions>({ width: 0, height: 0 });

  /** 最近错误。 */
  const error = ref<string | null>(null);

  /** 是否已被用户/系统结束共享。 */
  const endedByUser = ref(false);

  /** 是否已连接（尺寸就绪）。 */
  const connected = computed(
    () => phase.value === 'connected' && dimensions.value.width > 0 && dimensions.value.height > 0,
  );

  /** 画面指纹所需的分辨率（未连接为 0）。 */
  const width = computed(() => dimensions.value.width);
  const height = computed(() => dimensions.value.height);

  /**
   * 写入一次成功连接的结果。
   *
   * @param media 共享流。
   * @param videoEl video 元素。
   * @param dims 画面尺寸。
   */
  const setConnected = (
    media: MediaStream,
    videoEl: HTMLVideoElement | null,
    dims: StreamDimensions,
  ): void => {
    stream.value = media;
    video.value = videoEl;
    dimensions.value = dims;
    phase.value = 'connected';
    error.value = null;
    endedByUser.value = false;
  };

  /**
   * 标记连接失败。
   *
   * @param message 错误信息。
   */
  const setError = (message: string): void => {
    phase.value = 'error';
    error.value = message;
  };

  /**
   * 标记正在请求。
   */
  const setRequesting = (): void => {
    phase.value = 'requesting';
    error.value = null;
    endedByUser.value = false;
  };

  /**
   * 标记用户结束共享（`track.onended`）。
   */
  const setEndedByUser = (): void => {
    endedByUser.value = true;
    phase.value = 'idle';
    dimensions.value = { width: 0, height: 0 };
  };

  /**
   * 断开并清空状态。
   */
  const disconnect = (): void => {
    const media = stream.value;
    if (media) {
      media.getTracks().forEach((t) => {
        if (t.readyState !== 'ended') t.stop();
      });
    }
    if (video.value) video.value.srcObject = null;
    stream.value = null;
    video.value = null;
    dimensions.value = { width: 0, height: 0 };
    if (phase.value !== 'error') phase.value = 'idle';
  };

  return {
    stream,
    video,
    phase,
    dimensions,
    error,
    endedByUser,
    connected,
    width,
    height,
    setConnected,
    setError,
    setRequesting,
    setEndedByUser,
    disconnect,
  };
});
