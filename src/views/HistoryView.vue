<script setup lang="ts">
/**
 * HistoryView —— 历史记录页。
 *
 * 依据：架构文档 §2.13 / §4.4（历史页时序）+ PRD P0-18/P0-19 + P1（趋势图）。
 *
 * 内容：记录列表（`RecordListItem`）+ 详情 + 趋势图（P1）+ 导出/删除。
 */
import { computed, onMounted, ref } from 'vue';
import { useHistoryStore } from '@/stores/history';
import { useUiStore } from '@/stores/ui';
import { formatCompact, formatDateTime, formatDurationShort, PLACEHOLDER } from '@/utils/format';
import { TEXTS } from '@/constants/texts';
import { downloadText } from '@/utils/download';
import { pickTextFile } from '@/utils/download';
import RecordListItem from '@/components/RecordListItem.vue';
import TrendChart from '@/components/TrendChart.vue';
import EmptyState from '@/components/EmptyState.vue';

const history = useHistoryStore();
const ui = useUiStore();

/** 导入中标志。 */
const importing = ref(false);

/** 当前选中记录。（store 属性已解包，不写 `.value`） */
const selected = computed(() => history.selected);

/** 选中记录的净经验文本。 */
const selectedNetText = computed<string>(() =>
  selected.value && selected.value.netExp !== null
    ? formatCompact(selected.value.netExp)
    : TEXTS.NET_EXP_UNCONFIRMED,
);

/** 选中记录的经验/小时文本。 */
const selectedRateText = computed<string>(() => formatCompact(selected.value?.expPerHour ?? null));

/** 选中记录的金币/小时文本。 */
const selectedGoldRateText = computed<string>(() => formatCompact(selected.value?.goldPerHour ?? null));

/** 选中记录的时段文本。 */
const selectedPeriodText = computed<string>(() => {
  if (!selected.value) return PLACEHOLDER;
  const start = formatDateTime(selected.value.createdAt);
  const end = formatDateTime(selected.value.endedAt);
  return `${start} → ${end}`;
});

/**
 * 删除一条记录（二次确认）。
 *
 * @param id 记录 id。
 */
async function onRemove(id: string): Promise<void> {
  if (typeof window !== 'undefined' && !window.confirm('确定删除该记录？此操作不可撤销。')) return;
  const ok = await history.removeRecord(id);
  ui.pushToast(ok ? '已删除' : '删除失败', ok ? 'success' : 'error');
}

/**
 * 选中一条记录。
 *
 * @param id 记录 id。
 */
async function onSelect(id: string): Promise<void> {
  await history.select(id);
}

/** 导出全部记录。 */
async function onExport(): Promise<void> {
  if (history.count === 0) {
    ui.pushToast('暂无可导出的记录', 'warning');
    return;
  }
  const json = await history.exportJson();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadText(json, `maple-records-${stamp}.json`);
  ui.pushToast(`已导出 ${history.count} 条记录`, 'success');
}

/** 导入记录。 */
async function onImport(): Promise<void> {
  importing.value = true;
  try {
    const text = await pickTextFile('.json');
    if (text === null) return;
    const res = await history.importJson(text);
    if (res.ok) {
      ui.pushToast(`已导入 ${res.imported} 条记录`, 'success');
    } else {
      ui.pushToast(res.error ?? '导入失败', 'error');
    }
  } catch (e) {
    ui.pushToast(e instanceof Error ? e.message : '导入失败', 'error');
  } finally {
    importing.value = false;
  }
}

/** 清空全部记录（二次确认）。 */
async function onClearAll(): Promise<void> {
  if (history.count === 0) return;
  if (typeof window !== 'undefined' && !window.confirm('确定清空全部记录与采样点？此操作不可撤销。')) {
    return;
  }
  await history.clearAll();
  ui.pushToast('已清空全部记录', 'info');
}

onMounted(async () => {
  await history.reload();
});
</script>

<template>
  <div class="history-view">
    <header class="history-view__intro">
      <div>
        <h1 class="history-view__title">历史记录</h1>
        <p class="history-view__subtitle">共 {{ history.count }} 条记录，可导出为 JSON 备份。</p>
      </div>
      <div class="history-view__actions">
        <button type="button" class="hist-btn" :disabled="importing" @click="onImport">
          {{ importing ? '导入中…' : '导入' }}
        </button>
        <button type="button" class="hist-btn" @click="onExport">导出</button>
        <button type="button" class="hist-btn hist-btn--danger" @click="onClearAll">清空</button>
      </div>
    </header>

    <div v-if="history.error" class="history-view__error">{{ history.error }}</div>

    <div class="history-view__grid">
      <div class="history-view__col history-view__col--list">
        <EmptyState
          v-if="history.count === 0 && !history.loading"
          title="还没有记录"
          description="到「控制面板」连接游戏窗口并开始记录后，这里会显示每次升级的效率。"
        />
        <div v-else class="history-view__list">
          <RecordListItem
            v-for="rec in history.records"
            :key="rec.id"
            :record="rec"
            :selected="rec.id === history.selectedId"
            @select="onSelect"
            @remove="onRemove"
          />
        </div>
      </div>

      <div class="history-view__col history-view__col--detail">
        <EmptyState
          v-if="!selected"
          title="选择一条记录查看详情"
          description="点击左侧记录卡片可查看明细与效率趋势。"
        />
        <template v-else>
          <section class="history-card">
            <h2 class="history-card__title">记录详情</h2>
            <dl class="history-card__dl">
              <div>
                <dt>时段</dt>
                <dd>{{ selectedPeriodText }}</dd>
              </div>
              <div>
                <dt>有效时长</dt>
                <dd>{{ formatDurationShort(selected.durationMs) }}</dd>
              </div>
              <div>
                <dt>等级</dt>
                <dd>{{ selected.levelStart }} → {{ selected.levelEnd }}</dd>
              </div>
              <div>
                <dt>净经验</dt>
                <dd>{{ selectedNetText }}</dd>
              </div>
              <div>
                <dt>经验 / 小时</dt>
                <dd>{{ selectedRateText }}</dd>
              </div>
              <div>
                <dt>金币 / 小时</dt>
                <dd>{{ selectedGoldRateText }}</dd>
              </div>
              <div>
                <dt>采样点</dt>
                <dd>{{ history.selectedSamples.length }}</dd>
              </div>
              <div>
                <dt>连续区间</dt>
                <dd>
                  {{ selected.segments.length }} 段
                  <template v-if="selected.segments.some((s) => s.isRecoveredStart)">
                    （含 {{ selected.segments.filter((s) => s.isRecoveredStart).length }} 段恢复区间）
                  </template>
                </dd>
              </div>
            </dl>
          </section>

          <section class="history-card">
            <h2 class="history-card__title">效率趋势（P1）</h2>
            <TrendChart :samples="history.selectedSamples" />
          </section>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.history-view__intro {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.history-view__title {
  margin: 0;
  font-size: 20px;
  color: #303133;
}

.history-view__subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: #909399;
}

.history-view__actions {
  display: flex;
  gap: 8px;
}

.hist-btn {
  padding: 7px 14px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #ffffff;
  color: #606266;
  font-size: 13px;
  cursor: pointer;
}

.hist-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hist-btn--danger {
  color: #dc2626;
  border-color: #fca5a5;
}

.history-view__error {
  padding: 10px 14px;
  background: #fef2f2;
  border: 1px solid #fca5a5;
  border-radius: 8px;
  color: #dc2626;
  font-size: 13px;
}

.history-view__grid {
  display: grid;
  grid-template-columns: minmax(300px, 1fr) minmax(0, 1.4fr);
  gap: 16px;
  align-items: start;
}

@media (max-width: 980px) {
  .history-view__grid {
    grid-template-columns: 1fr;
  }
}

.history-view__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.history-view__col--detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
}

.history-card__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.history-card__dl {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px 16px;
  margin: 0;
}

.history-card__dl dt {
  font-size: 11px;
  color: #909399;
}

.history-card__dl dd {
  margin: 2px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  font-variant-numeric: tabular-nums;
}
</style>
