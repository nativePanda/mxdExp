<script setup lang="ts">
/**
 * StatTile —— 通用数值瓦片（标题 + 主数值 + 单位 + 次要说明）。
 *
 * 拒识约定：数值为 `null` 时显示「—」（由 `formatValue` 兜底），**绝不显示 0**。
 * 可信度提示：`muted=true` 时整体置灰（供实时效率面板在 `readState` 异常时复用）。
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 标题（如「近 60 秒」）。 */
    label: string;
    /** 已格式化好的数值文本；为 `null` 时显示占位符「—」。 */
    value: string | null;
    /** 单位（如「/小时」）。 */
    unit?: string;
    /** 次要说明（小字）。 */
    hint?: string;
    /** 是否置灰（数据可信度低）。 */
    muted?: boolean;
    /** 强调主色调。 */
    accent?: 'default' | 'exp' | 'gold';
  }>(),
  {
    unit: '',
    hint: '',
    muted: false,
    accent: 'default',
  },
);

/** 展示文本：`null` → 「—」。 */
const display = computed<string>(() => (props.value === null || props.value === '' ? '—' : props.value));

/** 根类名。 */
const rootClass = computed(() => ({
  'stat-tile': true,
  'stat-tile--muted': props.muted,
  [`stat-tile--${props.accent}`]: true,
}));
</script>

<template>
  <div :class="rootClass">
    <div class="stat-tile__label">{{ label }}</div>
    <div class="stat-tile__value-row">
      <span class="stat-tile__value">{{ display }}</span>
      <span v-if="unit" class="stat-tile__unit">{{ unit }}</span>
    </div>
    <div v-if="hint" class="stat-tile__hint">{{ hint }}</div>
  </div>
</template>

<style scoped>
.stat-tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
}

.stat-tile--muted {
  background: #f4f4f5;
  border-color: #e9e9eb;
}

.stat-tile__label {
  font-size: 12px;
  color: #909399;
}

.stat-tile__value-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.stat-tile__value {
  font-size: 22px;
  font-weight: 700;
  color: #303133;
  font-variant-numeric: tabular-nums;
}

.stat-tile--muted .stat-tile__value {
  color: #a8abb2;
}

.stat-tile--exp .stat-tile__value {
  color: #b45309;
}

.stat-tile--gold .stat-tile__value {
  color: #ca8a04;
}

.stat-tile__unit {
  font-size: 12px;
  color: #909399;
}

.stat-tile__hint {
  font-size: 12px;
  color: #a8abb2;
}
</style>
