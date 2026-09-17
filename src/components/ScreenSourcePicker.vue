<script setup lang="ts">
/**
 * ScreenSourcePicker —— 显示器 / 窗口选择（共享画面）。
 *
 * 说明：浏览器 `getDisplayMedia` 由用户在系统弹窗中选择具体窗口/显示器，
 * 本组件负责触发请求、展示连接态与错误，并把「重新选择 / 断开」暴露给用户。
 *
 * 不直接调用 `useDisplayStream`（避免重复持有流）：连接动作由父级注入，
 * 组件只做「展示 + 交互」。
 */
import { computed } from 'vue';
import type { StreamPhase } from '@/composables/useDisplayStream';

const props = defineProps<{
  /** 共享流状态机。 */
  phase: StreamPhase;
  /** 画面尺寸（未连接为 0）。 */
  width: number;
  /** 画面高度。 */
  height: number;
  /** 错误信息。 */
  error: string | null;
  /** 是否已被用户/系统结束共享。 */
  endedByUser: boolean;
}>();

const emit = defineEmits<{
  /** 请求连接。 */
  (e: 'connect'): void;
  /** 断开连接。 */
  (e: 'disconnect'): void;
}>();

/** 是否已连接。 */
const connected = computed<boolean>(() => props.phase === 'connected' && props.width > 0);

/** 是否请求中。 */
const requesting = computed<boolean>(() => props.phase === 'requesting');

/** 尺寸文本。 */
const sizeText = computed<string>(() =>
  connected.value ? `${props.width} × ${props.height}` : '—',
);

/** 提示文本。 */
const hintText = computed<string>(() => {
  if (props.error) return props.error;
  if (props.endedByUser) return '共享已结束，请重新选择游戏窗口';
  if (requesting.value) return '正在等待你在系统弹窗中选择窗口…';
  if (connected.value) return '已连接；可到「识别校准」框选区域';
  return '点击下方按钮，在系统弹窗中选择游戏窗口或显示器';
});
</script>

<template>
  <section class="source-picker">
    <header class="source-picker__head">
      <h3 class="source-picker__title">共享画面</h3>
      <span
        class="source-picker__badge"
        :class="{ 'source-picker__badge--ok': connected }"
      >{{ connected ? '已连接' : '未连接' }}</span>
    </header>

    <div class="source-picker__body">
      <div class="source-picker__meta">
        <span class="source-picker__meta-label">画面尺寸</span>
        <span class="source-picker__meta-value">{{ sizeText }}</span>
      </div>
      <p class="source-picker__hint" :class="{ 'source-picker__hint--error': !!error }">
        {{ hintText }}
      </p>
    </div>

    <div class="source-picker__actions">
      <button
        type="button"
        class="sp-btn sp-btn--primary"
        :disabled="requesting"
        @click="emit('connect')"
      >
        {{ connected ? '重新选择窗口' : requesting ? '请求中…' : '选择游戏窗口' }}
      </button>
      <button
        type="button"
        class="sp-btn"
        :disabled="!connected"
        @click="emit('disconnect')"
      >
        断开
      </button>
    </div>
  </section>
</template>

<style scoped>
.source-picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
}

.source-picker__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.source-picker__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.source-picker__badge {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: #909399;
  background: #f4f4f5;
  border: 1px solid #e9e9eb;
}

.source-picker__badge--ok {
  color: #15803d;
  background: #dcfce7;
  border-color: #86efac;
}

.source-picker__meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.source-picker__meta-label {
  font-size: 12px;
  color: #909399;
}

.source-picker__meta-value {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  font-variant-numeric: tabular-nums;
}

.source-picker__hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
}

.source-picker__hint--error {
  color: #dc2626;
}

.source-picker__actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.sp-btn {
  padding: 7px 16px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #ffffff;
  color: #606266;
  font-size: 14px;
  cursor: pointer;
}

.sp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sp-btn--primary {
  background: #f59e0b;
  border-color: #f59e0b;
  color: #ffffff;
}

.sp-btn--primary:hover:not(:disabled) {
  background: #d97706;
}
</style>
