<script setup lang="ts">
/**
 * EfficiencyTierTag —— 效率水平分档标签。
 *
 * 文案引用 `EFFICIENCY_TIER_TEXT`（`@/types/enums`，唯一真源）。
 */
import { computed } from 'vue';
import type { EfficiencyTier } from '@/types/enums';
import { EFFICIENCY_TIER_TEXT } from '@/types/enums';

const props = defineProps<{
  /** 分档；`null` 时不渲染语义（显示占位）。 */
  tier: EfficiencyTier | null;
}>();

/** 展示文案。 */
const text = computed<string>(() => (props.tier ? EFFICIENCY_TIER_TEXT[props.tier] : '—'));

/** 分档类名。 */
const tierClass = computed<string>(() => `tier-tag--${props.tier ?? 'none'}`);
</script>

<template>
  <span class="tier-tag" :class="tierClass">{{ text }}</span>
</template>

<style scoped>
.tier-tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #606266;
  background: #f4f4f5;
  border: 1px solid #e9e9eb;
}

.tier-tag--low {
  color: #909399;
}
.tier-tag--mid {
  color: #409eff;
  background: #ecf5ff;
  border-color: #b3d8ff;
}
.tier-tag--high {
  color: #b45309;
  background: #fef3c7;
  border-color: #fcd34d;
}
.tier-tag--veryHigh {
  color: #15803d;
  background: #dcfce7;
  border-color: #86efac;
}
</style>
