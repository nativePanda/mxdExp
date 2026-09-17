<script setup lang="ts">
/**
 * RegionList —— 6 区域定位状态列表（使用 `REGION_STATUS_TEXT`）。
 *
 * 每行展示：区域标签（`REGION_META.label`）、是否必填、定位状态（`RegionStatus` 文案）、
 * 矩形数值（归一化）；点击行切换当前选中区域（与预览框选联动）。
 */
import { computed } from 'vue';
import type { Region, RegionKey } from '@/types/calibration';
import { REGION_KEY_VALUES } from '@/types/calibration';
import type { RegionStatus } from '@/types/enums';
import { REGION_STATUS_TEXT } from '@/types/enums';
import { REGION_META } from '@/constants/regions';

const props = defineProps<{
  /** 六区域。 */
  regions: Record<RegionKey, Region>;
  /** 当前选中区域键。 */
  activeKey: RegionKey;
}>();

const emit = defineEmits<{
  /** 切换选中区域。 */
  (e: 'update:activeKey', key: RegionKey): void;
}>();

/** 行模型。 */
interface Row {
  key: RegionKey;
  label: string;
  required: boolean;
  status: RegionStatus;
  statusText: string;
  rectText: string;
  description: string;
}

/** 列表行。 */
const rows = computed<Row[]>(() =>
  REGION_KEY_VALUES.map((key) => {
    const meta = REGION_META[key];
    const region = props.regions[key];
    const statusText = REGION_STATUS_TEXT[region.status];
    const rectText =
      region.w > 0 && region.h > 0
        ? `x ${region.x.toFixed(3)} · y ${region.y.toFixed(3)} · ${region.w.toFixed(3)}×${region.h.toFixed(3)}`
        : '—';
    return {
      key,
      label: meta.label,
      required: meta.required,
      status: region.status,
      statusText,
      rectText,
      description: meta.description,
    };
  }),
);

/**
 * 状态对应的类名。
 *
 * @param status 定位状态。
 * @returns class 名。
 */
function statusClass(status: RegionStatus): string {
  return `region-list__status--${status}`;
}
</script>

<template>
  <ul class="region-list">
    <li
      v-for="row in rows"
      :key="row.key"
      class="region-list__item"
      :class="{ 'region-list__item--active': row.key === activeKey }"
      @click="emit('update:activeKey', row.key)"
    >
      <div class="region-list__main">
        <span class="region-list__label">{{ row.label }}</span>
        <span v-if="row.required" class="region-list__required">必填</span>
        <span v-else class="region-list__optional">选填</span>
      </div>
      <div class="region-list__meta" :title="row.description">{{ row.rectText }}</div>
      <span class="region-list__status" :class="statusClass(row.status)">{{ row.statusText }}</span>
    </li>
  </ul>
</template>

<style scoped>
.region-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.region-list__item {
  display: grid;
  grid-template-columns: 1fr 1.4fr auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #ffffff;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.region-list__item:hover {
  border-color: #c6c8cc;
}

.region-list__item--active {
  border-color: #f59e0b;
  background: #fffbeb;
}

.region-list__main {
  display: flex;
  align-items: center;
  gap: 6px;
}

.region-list__label {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.region-list__required,
.region-list__optional {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
}

.region-list__required {
  color: #b45309;
  background: #fef3c7;
}

.region-list__optional {
  color: #909399;
  background: #f4f4f5;
}

.region-list__meta {
  font-size: 11px;
  color: #909399;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.region-list__status {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.region-list__status--located {
  color: #15803d;
}

.region-list__status--unlocated {
  color: #dc2626;
}

.region-list__status--identifying {
  color: #b45309;
}
</style>
