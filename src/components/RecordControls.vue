<script setup lang="ts">
/**
 * RecordControls —— 记录控制：开始 / 暂停 / 继续 / 结束。
 *
 * 行为由 `RecordStatus` 决定（按钮可用性 + 主操作文案），文案引用 `RECORD_STATUS_TEXT`。
 * 结束为异步（`finish` 会批量落库），期间按钮禁用并展示保存态。
 */
import { computed } from 'vue';
import type { RecordStatus } from '@/types/enums';
import { RECORD_STATUS_TEXT } from '@/types/enums';

const props = defineProps<{
  /** 当前记录状态。 */
  status: RecordStatus;
  /** 是否正在保存。 */
  saving: boolean;
  /** 是否已连接共享流（未连接时不允许开始）。 */
  streamReady: boolean;
  /** 是否已完成必要校准（未校准时给出弱提示，不硬阻断）。 */
  calibrated: boolean;
}>();

const emit = defineEmits<{
  /** 开始。 */
  (e: 'start'): void;
  /** 暂停。 */
  (e: 'pause'): void;
  /** 继续。 */
  (e: 'resume'): void;
  /** 结束。 */
  (e: 'finish'): void;
}>();

/** 是否可开始。 */
const canStart = computed<boolean>(() => props.status === 'idle' && props.streamReady && !props.saving);

/** 是否可暂停。 */
const canPause = computed<boolean>(() => props.status === 'recording' && !props.saving);

/** 是否可继续。 */
const canResume = computed<boolean>(() => props.status === 'paused' && !props.saving);

/** 是否可结束。 */
const canFinish = computed<boolean>(
  () => (props.status === 'recording' || props.status === 'paused') && !props.saving,
);

/** 状态文案。 */
const statusText = computed<string>(() => RECORD_STATUS_TEXT[props.status]);

/** 未连接流时的提示。 */
const blockedHint = computed<string>(() =>
  !props.streamReady && props.status === 'idle' ? '请先在下方选择并连接游戏窗口' : '',
);

/** 未校准提示。 */
const calibrationHint = computed<string>(() =>
  props.streamReady && !props.calibrated ? '尚未完成识别校准，采集可能降级（建议先校准）' : '',
);
</script>

<template>
  <section class="record-controls">
    <div class="record-controls__status">
      <span class="record-controls__status-label">状态</span>
      <span class="record-controls__status-value">{{ statusText }}</span>
    </div>

    <div class="record-controls__buttons">
      <button
        type="button"
        class="rc-btn rc-btn--primary"
        :disabled="!canStart"
        @click="emit('start')"
      >
        开始记录
      </button>
      <button type="button" class="rc-btn" :disabled="!canPause" @click="emit('pause')">
        暂停
      </button>
      <button type="button" class="rc-btn" :disabled="!canResume" @click="emit('resume')">
        继续
      </button>
      <button
        type="button"
        class="rc-btn rc-btn--danger"
        :disabled="!canFinish"
        @click="emit('finish')"
      >
        {{ saving ? '正在保存…' : '结束记录' }}
      </button>
    </div>

    <p v-if="blockedHint" class="record-controls__hint">{{ blockedHint }}</p>
    <p v-else-if="calibrationHint" class="record-controls__hint record-controls__hint--warn">
      {{ calibrationHint }}
    </p>
  </section>
</template>

<style scoped>
.record-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
}

.record-controls__status {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.record-controls__status-label {
  font-size: 12px;
  color: #909399;
}

.record-controls__status-value {
  font-size: 15px;
  font-weight: 600;
  color: #b45309;
}

.record-controls__buttons {
  display: flex;
  gap: 8px;
}

.rc-btn {
  padding: 7px 16px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #ffffff;
  color: #606266;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}

.rc-btn:hover:not(:disabled) {
  border-color: #c6c8cc;
  color: #303133;
}

.rc-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.rc-btn--primary {
  background: #f59e0b;
  border-color: #f59e0b;
  color: #ffffff;
}

.rc-btn--primary:hover:not(:disabled) {
  background: #d97706;
  border-color: #d97706;
  color: #ffffff;
}

.rc-btn--danger {
  color: #dc2626;
  border-color: #fca5a5;
}

.rc-btn--danger:hover:not(:disabled) {
  background: #fef2f2;
}

.record-controls__hint {
  margin: 0;
  font-size: 12px;
  color: #909399;
}

.record-controls__hint--warn {
  color: #b45309;
}
</style>
