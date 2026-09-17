<script setup lang="ts">
/**
 * CalibrationView —— 识别校准页。
 *
 * 依据：架构文档 §2.13 / §5.2 + PRD P0-14..P0-17。
 *
 * 内容：画面预览 + 6 区域框选（`expBar`/`expText`/`level`/`gold`/`hp`/`mp`）+ 区域定位状态表
 * + 字形模板向导入口 + 保存/恢复默认。
 *
 * 说明：画面共享由控制面板（PanelView）负责；本页若检测到未连接，提示先回控制面板选择窗口
 * （`TEXTS.NEED_WINDOW`）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useDisplayStream } from '@/composables/useDisplayStream';
import { useCalibrationStore } from '@/stores/calibration';
import { useTemplatesStore } from '@/stores/templates';
import { useStreamStore } from '@/stores/stream';
import { useUiStore } from '@/stores/ui';
import { checkCalibration, buildDefaultLayout } from '@/composables/useAutoCalibrate';
import type { RegionKey, RegionRect } from '@/types/calibration';
import { REGION_KEY_VALUES } from '@/types/calibration';
import { TEXTS } from '@/constants/texts';
import PreviewCanvas from '@/components/PreviewCanvas.vue';
import RegionList from '@/components/RegionList.vue';
import GlyphWizardDialog from '@/components/GlyphWizardDialog.vue';

const router = useRouter();
// 复用全局共享流状态（由 PanelView 建立）；本页不再单独请求，避免重复弹窗。
const display = useDisplayStream({ autoDisconnectOnUnmount: false });
const calibration = useCalibrationStore();
const templates = useTemplatesStore();
const streamStore = useStreamStore();
const ui = useUiStore();

/** 当前选中区域键。 */
const activeKey = ref<RegionKey>('expBar');

/** 字形向导可见性。 */
const wizardVisible = ref(false);

/** 向导忙碌态。 */
const wizardBusy = ref(false);

/** 是否已连接画面（用全局 stream store 判断，跨页保持）。store 属性已解包。 */
const connected = computed<boolean>(() => streamStore.connected);

/** 预览尺寸（优先用 stream store；回退 display）。 */
const width = computed<number>(() => streamStore.width || display.dimensions.value.width);
const height = computed<number>(() => streamStore.height || display.dimensions.value.height);

/** 预览 video 元素（来自全局 stream store）。 */
const videoEl = computed<HTMLVideoElement | null>(() => streamStore.video);

/** 巡检结果。 */
const check = computed(() => checkCalibration(calibration.config));

/** 必填是否齐全。 */
const requiredOk = computed<boolean>(() => check.value.ok);

/** 六个区域（供预览叠加）。 */
const regions = computed(() => calibration.config.regions);

/** 当前生效模板库的字符列表（升序）。 */
const activeChars = computed<string[]>(() => {
  const bank = templates.activeBank;
  if (!bank) return [];
  return Array.from(bank.keys()).sort();
});

/** 内置模板库字符数。 */
const defaultCount = computed<number>(() => templates.defaultBank?.size ?? 0);

/** 自定义模板库字符数。 */
const customCount = computed<number>(() => templates.customBank?.size ?? 0);

/**
 * 处理框选更新。
 *
 * @param key 区域键。
 * @param rect 归一化矩形。
 */
function onRegionUpdate(key: RegionKey, rect: RegionRect): void {
  calibration.setRegionRect(key, rect);
}

/** 一键按默认布局填充（全部置为已定位，便于微调）。 */
async function onFillDefault(): Promise<void> {
  const layout = buildDefaultLayout(calibration.expSplit);
  for (const key of REGION_KEY_VALUES) {
    calibration.setRegionRect(key, layout[key]);
  }
  calibration.setRegionStatus('expBar', 'located');
  ui.pushToast('已按默认布局填充，请按实际画面微调', 'info');
}

/** 拆分经验条 / 经验数值框。 */
function onSplitExp(): void {
  calibration.splitExpRegions();
  ui.pushToast('已拆分经验条与经验数值框，可分别调整', 'info');
}

/** 保存校准。 */
async function onSave(): Promise<void> {
  if (!connected.value) {
    ui.pushToast(TEXTS.NEED_WINDOW, 'warning');
    return;
  }
  await calibration.save();
  ui.pushToast('校准已保存', 'success');
}

/** 恢复默认（清空框选）。 */
async function onReset(): Promise<void> {
  await calibration.resetDefault();
  ui.pushToast('已恢复默认框选', 'info');
}

/** 打开字形向导。 */
async function onOpenWizard(): Promise<void> {
  await templates.load();
  wizardVisible.value = true;
}

/** 重建内置模板库。 */
async function onRebuildDefault(): Promise<void> {
  wizardBusy.value = true;
  try {
    await templates.load();
    ui.pushToast('内置模板库已就绪', 'success');
  } finally {
    wizardBusy.value = false;
  }
}

/** 清除自定义模板库。 */
async function onClearCustom(): Promise<void> {
  await templates.clearCustom();
  ui.pushToast('已清除自定义模板库，回退内置', 'info');
}

/**
 * 切换到指定区域。
 *
 * @param key 区域键。
 */
function updateActiveKey(key: RegionKey): void {
  activeKey.value = key;
}

/** 回到控制面板选择窗口。 */
function goPanel(): void {
  void router.push('/panel');
}

onMounted(async () => {
  await templates.load();
});
</script>

<template>
  <div class="calib-view">
    <header class="calib-view__intro">
      <h1 class="calib-view__title">识别校准</h1>
      <p class="calib-view__subtitle">
        框选经验条、经验数值、金币等区域；坐标为相对画面的比例，分辨率变化需重标。
      </p>
    </header>

    <div v-if="!connected" class="calib-view__need-window">
      <p>{{ TEXTS.NEED_WINDOW }}</p>
      <button type="button" class="calib-btn calib-btn--primary" @click="goPanel">
        前往控制面板选择窗口
      </button>
    </div>

    <div v-else class="calib-view__grid">
      <div class="calib-view__col calib-view__col--preview">
        <PreviewCanvas
          :width="width"
          :height="height"
          :video-el="videoEl"
          :overlay="true"
          :regions="regions"
          :active-key="activeKey"
          @update:active-key="updateActiveKey"
          @update:region="onRegionUpdate"
        />
        <p class="calib-view__tip">
          在预览中拖拽绘制「当前选中区域」的矩形；点击已有框可切换选中。按 Esc 取消当前绘制。
        </p>
      </div>

      <div class="calib-view__col calib-view__col--side">
        <section class="calib-card">
          <header class="calib-card__head">
            <h2 class="calib-card__title">区域状态</h2>
            <span
              class="calib-card__badge"
              :class="requiredOk ? 'calib-card__badge--ok' : 'calib-card__badge--warn'"
            >
              {{ requiredOk ? '必填已就绪' : TEXTS.NO_VALID_LOCATION }}
            </span>
          </header>
          <RegionList
            :regions="regions"
            :active-key="activeKey"
            @update:active-key="updateActiveKey"
          />
        </section>

        <section class="calib-card">
          <h2 class="calib-card__title">字形模板</h2>
          <p class="calib-card__text">
            当前生效：{{ activeChars.length }} 字形（内置 {{ defaultCount }} · 自定义 {{ customCount }}）。
          </p>
          <div class="calib-card__row">
            <button type="button" class="calib-btn" @click="onOpenWizard">打开字形向导</button>
          </div>
        </section>

        <section class="calib-card">
          <h2 class="calib-card__title">操作</h2>
          <div class="calib-card__row">
            <button type="button" class="calib-btn" @click="onFillDefault">按默认布局填充</button>
            <button type="button" class="calib-btn" @click="onSplitExp">拆分经验条 / 数值</button>
          </div>
          <div class="calib-card__row">
            <button type="button" class="calib-btn calib-btn--primary" @click="onSave">
              保存校准
            </button>
            <button type="button" class="calib-btn calib-btn--danger" @click="onReset">
              恢复默认
            </button>
          </div>
        </section>
      </div>
    </div>

    <GlyphWizardDialog
      v-model="wizardVisible"
      :active-chars="activeChars"
      :default-count="defaultCount"
      :custom-count="customCount"
      :use-custom="templates.useCustom"
      :busy="wizardBusy"
      @rebuild-default="onRebuildDefault"
      @clear-custom="onClearCustom"
      @set-use-custom="(v) => templates.setUseCustom(v)"
    />
  </div>
</template>

<style scoped>
.calib-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.calib-view__title {
  margin: 0;
  font-size: 20px;
  color: #303133;
}

.calib-view__subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: #909399;
}

.calib-view__need-window {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 24px;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 10px;
  color: #b45309;
}

.calib-view__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(320px, 1fr);
  gap: 16px;
  align-items: start;
}

@media (max-width: 980px) {
  .calib-view__grid {
    grid-template-columns: 1fr;
  }
}

.calib-view__col {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.calib-view__tip {
  margin: 0;
  font-size: 12px;
  color: #909399;
}

.calib-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
}

.calib-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.calib-card__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.calib-card__badge {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
}

.calib-card__badge--ok {
  color: #15803d;
  background: #dcfce7;
}

.calib-card__badge--warn {
  color: #b45309;
  background: #fef3c7;
}

.calib-card__text {
  margin: 0;
  font-size: 13px;
  color: #606266;
}

.calib-card__row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.calib-btn {
  padding: 7px 14px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #ffffff;
  color: #606266;
  font-size: 13px;
  cursor: pointer;
}

.calib-btn:hover {
  border-color: #c6c8cc;
}

.calib-btn--primary {
  background: #f59e0b;
  border-color: #f59e0b;
  color: #ffffff;
}

.calib-btn--danger {
  color: #dc2626;
  border-color: #fca5a5;
}
</style>
