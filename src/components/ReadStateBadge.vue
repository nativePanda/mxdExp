<script setup lang="ts">
/**
 * ReadStateBadge —— 读数状态徽标。
 *
 * 通过 `READ_STATE_IS_ALERT`（`@/types/enums`，唯一真源）决定**是否为警告色**：
 * - 非警告态（`waiting` / `accumulating` / `confirming` / `confirmed` / `recovered`）用中性/弱色；
 * - 警告态（`missingCrossLevel` / `timeout` / `interrupted` / `unconfirmedNet`）用警示色。
 *
 * 文案一律引用 `READ_STATE_TEXT` / `READ_STATE_DESC`，不在此手写中文。
 */
import { computed } from 'vue';
import type { ReadState } from '@/types/enums';
import { READ_STATE_TEXT, READ_STATE_DESC, READ_STATE_IS_ALERT } from '@/types/enums';

const props = defineProps<{
  /** 当前读数状态。 */
  state: ReadState;
}>();

/** 主文案。 */
const text = computed<string>(() => READ_STATE_TEXT[props.state]);

/** hover 解释。 */
const desc = computed<string>(() => READ_STATE_DESC[props.state]);

/** 是否警告态。 */
const isAlert = computed<boolean>(() => READ_STATE_IS_ALERT[props.state]);
</script>

<template>
  <span
    class="read-state-badge"
    :class="{ 'read-state-badge--alert': isAlert }"
    :title="desc"
  >
    <span class="read-state-badge__dot" aria-hidden="true" />
    {{ text }}
  </span>
</template>

<style scoped>
.read-state-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: #606266;
  background: #f4f4f5;
  border: 1px solid #e9e9eb;
  white-space: nowrap;
}

.read-state-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #909399;
}

.read-state-badge--alert {
  color: #b45309;
  background: #fef3c7;
  border-color: #fcd34d;
}

.read-state-badge--alert .read-state-badge__dot {
  background: #f59e0b;
}
</style>
