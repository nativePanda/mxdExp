<script setup lang="ts">
/**
 * RecordListItem —— 历史记录单条卡片。
 *
 * 展示：开始时间、时长、等级区间、净经验、经验/小时、效率分档、升级次数。
 * 拒识约定：`netExp === null` 时显示 `TEXTS.NET_EXP_UNCONFIRMED`（而非 0）。
 */
import { computed } from 'vue';
import type { Record as MapleRecord } from '@/types/models';
import { formatCompact, formatDurationShort, formatDateTime, PLACEHOLDER } from '@/utils/format';
import { TEXTS } from '@/constants/texts';
import EfficiencyTierTag from './EfficiencyTierTag.vue';

const props = withDefaults(
  defineProps<{
    /** 记录。 */
    record: MapleRecord;
    /** 是否选中。 */
    selected?: boolean;
  }>(),
  { selected: false },
);

const emit = defineEmits<{
  /** 选中。 */
  (e: 'select', id: string): void;
  /** 删除。 */
  (e: 'remove', id: string): void;
}>();

/** 净经验文本（`null` → 未确认说明）。 */
const netText = computed<string>(() =>
  props.record.netExp === null ? TEXTS.NET_EXP_UNCONFIRMED : formatCompact(props.record.netExp),
);

/** 经验/小时文本。 */
const rateText = computed<string>(() => formatCompact(props.record.expPerHour));

/** 时长文本。 */
const durationText = computed<string>(() => formatDurationShort(props.record.durationMs));

/** 时间文本。 */
const timeText = computed<string>(() => formatDateTime(props.record.createdAt));

/** 等级区间文本。 */
const levelText = computed<string>(() => {
  const { levelStart, levelEnd } = props.record;
  if (levelStart <= 0 && levelEnd <= 0) return PLACEHOLDER;
  return levelStart === levelEnd ? `Lv.${levelStart}` : `Lv.${levelStart} → ${levelEnd}`;
});

/** 升级次数。 */
const levelUpCount = computed<number>(() => props.record.levelUps.length);

/** 是否有未确认区间。 */
const unconfirmed = computed<boolean>(() => props.record.netExp === null);
</script>

<template>
  <article
    class="record-item"
    :class="{ 'record-item--selected': selected }"
    @click="emit('select', record.id)"
  >
    <header class="record-item__head">
      <span class="record-item__time">{{ timeText }}</span>
      <EfficiencyTierTag :tier="record.efficiencyTier" />
    </header>

    <div class="record-item__grid">
      <div class="record-item__cell">
        <span class="record-item__label">时长</span>
        <span class="record-item__value">{{ durationText }}</span>
      </div>
      <div class="record-item__cell">
        <span class="record-item__label">等级</span>
        <span class="record-item__value">{{ levelText }}</span>
      </div>
      <div class="record-item__cell">
        <span class="record-item__label">升级</span>
        <span class="record-item__value">{{ levelUpCount }} 次</span>
      </div>
    </div>

    <div class="record-item__footer">
      <div class="record-item__net" :class="{ 'record-item__net--warn': unconfirmed }">
        <span class="record-item__label">净经验</span>
        <span class="record-item__net-value">{{ netText }}</span>
      </div>
      <div class="record-item__rate">
        <span class="record-item__label">经验 / 小时</span>
        <span class="record-item__value">{{ rateText }}</span>
      </div>
      <button
        type="button"
        class="record-item__del"
        title="删除该记录"
        @click.stop="emit('remove', record.id)"
      >
        删除
      </button>
    </div>
  </article>
</template>

<style scoped>
.record-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.record-item:hover {
  border-color: #c6c8cc;
}

.record-item--selected {
  border-color: #f59e0b;
  box-shadow: 0 0 0 2px rgb(245 158 11 / 15%);
}

.record-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.record-item__time {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.record-item__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.record-item__cell,
.record-item__net,
.record-item__rate {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.record-item__label {
  font-size: 11px;
  color: #909399;
}

.record-item__value {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  font-variant-numeric: tabular-nums;
}

.record-item__footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding-top: 8px;
  border-top: 1px dashed #ebeef5;
}

.record-item__net-value {
  font-size: 16px;
  font-weight: 700;
  color: #b45309;
  font-variant-numeric: tabular-nums;
}

.record-item__net--warn .record-item__net-value {
  font-size: 12px;
  font-weight: 600;
  color: #dc2626;
}

.record-item__del {
  padding: 4px 10px;
  border: 1px solid #fca5a5;
  border-radius: 6px;
  background: #ffffff;
  color: #dc2626;
  font-size: 12px;
  cursor: pointer;
}

.record-item__del:hover {
  background: #fef2f2;
}
</style>
