<script setup lang="ts">
/**
 * SettingsView —— 设置页。
 *
 * 依据：架构文档 §2.13 + PRD P0-20/P0-21 + §6.9。
 *
 * 内容：性能档位（`PerfTier`）、采集帧率、经验表管理（`ExpTableSource`）、数据导入导出、诊断信息。
 */
import { computed, onMounted, ref } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { useExpTableStore } from '@/stores/expTable';
import { useHistoryStore } from '@/stores/history';
import { useCalibrationStore } from '@/stores/calibration';
import { useTemplatesStore } from '@/stores/templates';
import { useStreamStore } from '@/stores/stream';
import { useUiStore } from '@/stores/ui';
import type { PerfTier } from '@/types/enums';
import { PERF_TIER_VALUES, PERF_TIER_TEXT, EXP_TABLE_SOURCE_TEXT } from '@/types/enums';
import { PERF_PRESETS, MIN_CAPTURE_FPS, MAX_CAPTURE_FPS } from '@/constants/perf';
import { APP_VERSION } from '@/utils/diag';
import { downloadText } from '@/utils/download';
import { SCHEMA_VERSION, type ExpTableRow } from '@/types/models';

const settings = useSettingsStore();
const expTable = useExpTableStore();
const history = useHistoryStore();
const calibration = useCalibrationStore();
const templates = useTemplatesStore();
const stream = useStreamStore();
const ui = useUiStore();

/** 导入经验表文本。 */
const expTableText = ref('');

/** 经验表来源统计。（store 属性已解包，不写 `.value`） */
const sourceStats = computed(() => {
  const stats: Record<string, number> = { builtin: 0, inferred: 0, imported: 0 };
  for (const row of expTable.rows) stats[row.source] = (stats[row.source] ?? 0) + 1;
  return stats;
});

/** 性能档位选项。 */
const perfOptions = computed(() =>
  PERF_TIER_VALUES.map((tier) => ({
    tier,
    label: PERF_TIER_TEXT[tier],
    preset: PERF_PRESETS[tier],
  })),
);

/** 频率范围提示。 */
const fpsRange = computed<string>(() => `${MIN_CAPTURE_FPS} ~ ${MAX_CAPTURE_FPS} 次/秒`);

/**
 * 切换性能档位。
 *
 * @param tier 档位。
 */
async function onSetPerfTier(tier: PerfTier): Promise<void> {
  await settings.setPerfTier(tier);
  ui.pushToast(`已切换为「${PERF_TIER_TEXT[tier]}」档`, 'success');
}

/**
 * 修改采集频率。
 *
 * @param e 输入事件。
 */
async function onCaptureFpsChange(e: Event): Promise<void> {
  const v = Number((e.target as HTMLInputElement).value);
  await settings.setCaptureFps(v);
}

/**
 * 修改画面检查频率。
 *
 * @param e 输入事件。
 */
async function onCheckFpsChange(e: Event): Promise<void> {
  const v = Number((e.target as HTMLInputElement).value);
  await settings.setCheckFps(v);
}

/** 导出经验表为 JSON。 */
function onExportExpTable(): void {
  if (expTable.rows.length === 0) {
    ui.pushToast('经验表为空', 'warning');
    return;
  }
  const payload = { app: 'maple_exp_tracker', kind: 'expTable', schemaVersion: SCHEMA_VERSION, rows: expTable.rows };
  downloadText(JSON.stringify(payload, null, 2), 'maple-exp-table.json');
  ui.pushToast('已导出经验表', 'success');
}

/** 导入经验表（从文本框 JSON）。 */
async function onImportExpTable(): Promise<void> {
  const text = expTableText.value.trim();
  if (!text) {
    ui.pushToast('请先粘贴经验表 JSON', 'warning');
    return;
  }
  try {
    const parsed = JSON.parse(text) as { rows?: unknown };
    const rows = Array.isArray(parsed.rows) ? (parsed.rows as ExpTableRow[]) : [];
    const valid = rows.filter(
      (r) => typeof r.level === 'number' && typeof r.requiredExp === 'number',
    );
    if (valid.length === 0) {
      ui.pushToast('未解析到有效的经验表行', 'error');
      return;
    }
    await expTable.saveMany(
      valid.map((r) => ({
        level: r.level,
        requiredExp: r.requiredExp,
        approximate: r.approximate ?? true,
        source: 'imported',
        updatedAt: Date.now(),
      })),
    );
    ui.pushToast(`已导入 ${valid.length} 行经验表`, 'success');
    expTableText.value = '';
  } catch (e) {
    ui.pushToast(e instanceof Error ? e.message : 'JSON 解析失败', 'error');
  }
}

/** 导出全部记录。 */
async function onExportRecords(): Promise<void> {
  if (history.count === 0) await history.reload();
  if (history.count === 0) {
    ui.pushToast('暂无可导出的记录', 'warning');
    return;
  }
  const json = await history.exportJson();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadText(json, `maple-records-${stamp}.json`);
  ui.pushToast('已导出全部记录', 'success');
}

/** 复制诊断信息。 */
async function onCopyDiagnostics(): Promise<void> {
  const text = await ui.collectAndCopyDiagnostics({
    width: stream.width,
    height: stream.height,
    perfTier: PERF_TIER_TEXT[settings.settings.perfTier],
    captureFps: settings.captureFps,
    checkFps: settings.checkFps,
  });
  void text;
  ui.pushToast('诊断信息已复制到剪贴板', 'success');
}

/** 恢复出厂设置（清空校准 / 模板 / 经验表 / 设置）。 */
async function onResetFactory(): Promise<void> {
  if (typeof window !== 'undefined' && !window.confirm('恢复出厂设置将清空设置、校准与经验表，是否继续？')) {
    return;
  }
  await calibration.clearAll();
  await templates.clearCustom();
  await expTable.clear();
  await settings.resetFactory();
  ui.pushToast('已恢复出厂设置', 'info');
}

/** 诊断信息展示文本。 */
const diagnosticsText = computed<string>(() => ui.lastDiagnostics ?? '（尚未生成）');

onMounted(async () => {
  await settings.load();
  await expTable.load();
});
</script>

<template>
  <div class="settings-view">
    <header class="settings-view__intro">
      <h1 class="settings-view__title">设置</h1>
      <p class="settings-view__subtitle">版本 v{{ APP_VERSION }} · 数据模型 v{{ SCHEMA_VERSION }}</p>
    </header>

    <section class="settings-card">
      <h2 class="settings-card__title">识别性能档位</h2>
      <div class="settings-card__perf">
        <button
          v-for="opt in perfOptions"
          :key="opt.tier"
          type="button"
          class="perf-btn"
          :class="{ 'perf-btn--active': settings.settings.perfTier === opt.tier }"
          @click="onSetPerfTier(opt.tier)"
        >
          <span class="perf-btn__label">{{ opt.label }}</span>
          <span class="perf-btn__desc">{{ opt.preset.description }}</span>
        </button>
      </div>
      <div class="settings-card__row">
        <label class="settings-card__field">
          <span>采集帧率（{{ fpsRange }}）</span>
          <input
            type="number"
            :value="settings.captureFps"
            :min="MIN_CAPTURE_FPS"
            :max="MAX_CAPTURE_FPS"
            step="0.25"
            @change="onCaptureFpsChange"
          />
        </label>
        <label class="settings-card__field">
          <span>画面检查帧率</span>
          <input
            type="number"
            :value="settings.checkFps"
            :min="MIN_CAPTURE_FPS"
            :max="MAX_CAPTURE_FPS"
            step="0.25"
            @change="onCheckFpsChange"
          />
        </label>
      </div>
    </section>

    <section class="settings-card">
      <h2 class="settings-card__title">经验表管理</h2>
      <p class="settings-card__text">
        共 {{ expTable.size }} 行：内置 {{ sourceStats.builtin }} · 自动推导
        {{ sourceStats.inferred }} · 手动导入 {{ sourceStats.imported }}
        （来源文案：{{ EXP_TABLE_SOURCE_TEXT.builtin }} / {{ EXP_TABLE_SOURCE_TEXT.inferred }} /
        {{ EXP_TABLE_SOURCE_TEXT.imported }}）。
      </p>
      <div class="settings-card__row">
        <button type="button" class="set-btn" @click="onExportExpTable">导出经验表</button>
      </div>
      <textarea
        v-model="expTableText"
        class="settings-card__textarea"
        rows="4"
        placeholder='粘贴经验表 JSON，例如 {"rows":[{"level":10,"requiredExp":12345}]}'
      />
      <div class="settings-card__row">
        <button type="button" class="set-btn set-btn--primary" @click="onImportExpTable">
          导入经验表
        </button>
      </div>
    </section>

    <section class="settings-card">
      <h2 class="settings-card__title">数据备份</h2>
      <div class="settings-card__row">
        <button type="button" class="set-btn" @click="onExportRecords">导出全部记录</button>
      </div>
      <p class="settings-card__text">
        导入记录请前往「历史记录」页（会与现有记录按 id 合并/覆盖）。
      </p>
    </section>

    <section class="settings-card">
      <h2 class="settings-card__title">诊断信息</h2>
      <div class="settings-card__row">
        <button type="button" class="set-btn" @click="onCopyDiagnostics">复制诊断信息</button>
      </div>
      <pre class="settings-card__diag">{{ diagnosticsText }}</pre>
    </section>

    <section class="settings-card settings-card--danger">
      <h2 class="settings-card__title">重置</h2>
      <p class="settings-card__text">恢复出厂设置会清空设置、校准框选与经验表（不影响已保存的历史记录）。</p>
      <div class="settings-card__row">
        <button type="button" class="set-btn set-btn--danger" @click="onResetFactory">
          恢复出厂设置
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 860px;
}

.settings-view__title {
  margin: 0;
  font-size: 20px;
  color: #303133;
}

.settings-view__subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: #909399;
}

.settings-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
}

.settings-card--danger {
  border-color: #fca5a5;
}

.settings-card__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.settings-card__text {
  margin: 0;
  font-size: 13px;
  color: #606266;
}

.settings-card__perf {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

@media (max-width: 720px) {
  .settings-card__perf {
    grid-template-columns: repeat(2, 1fr);
  }
}

.perf-btn {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  background: #ffffff;
  cursor: pointer;
  text-align: left;
}

.perf-btn--active {
  border-color: #f59e0b;
  background: #fffbeb;
}

.perf-btn__label {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.perf-btn__desc {
  font-size: 11px;
  color: #909399;
}

.settings-card__row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.settings-card__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #606266;
}

.settings-card__field input {
  width: 160px;
  padding: 6px 8px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 13px;
}

.settings-card__textarea {
  width: 100%;
  padding: 8px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  resize: vertical;
}

.settings-card__diag {
  margin: 0;
  padding: 10px;
  background: #fafafa;
  border-radius: 8px;
  font-size: 12px;
  color: #606266;
  white-space: pre-wrap;
}

.set-btn {
  padding: 7px 14px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #ffffff;
  color: #606266;
  font-size: 13px;
  cursor: pointer;
}

.set-btn--primary {
  background: #f59e0b;
  border-color: #f59e0b;
  color: #ffffff;
}

.set-btn--danger {
  color: #dc2626;
  border-color: #fca5a5;
}
</style>
