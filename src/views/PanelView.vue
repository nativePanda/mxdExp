<script setup lang="ts">
/**
 * PanelView —— 控制面板（三步引导 → 共享流选择 → 预览 → 经验卡/金币卡 → 实时效率面板 → 记录控制）。
 *
 * 依据：架构文档 §4.1（初始化时序）/ §4.2（单帧采集）/ §2.13（页面清单）+ PRD P0-1..P0-9。
 *
 * ## 装配
 * - `useDisplayStream`：请求/断开共享画面；
 * - `useFrameGrabber`：把 video 接入抓帧器（归一化 → 像素的唯一入口）；
 * - `useCaptureLoop`：Worker tick 驱动的单帧管线（纯逻辑在 composable 内）；
 * - `useRecordStore`：记录生命周期 + 实时快照；
 * - `calibration` / `templates` / `settings` store：校准 / 模板库 / 频率。
 *
 * ## 数据可信度（缺陷 2 架构决策）
 * 实时效率面板依据 `record.readState` 表达数据可信度：`READ_STATE_IS_ALERT` 命中时
 * 由 `RateComparePanel` 置灰陈旧数值。本页只负责把 `readState` 传下去。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import CaptureWorker from '@/workers/capture.worker?worker';
import type { WorkerToMain } from '@/types/messages';
import type { ClientInfo } from '@/types/models';
import { useDisplayStream } from '@/composables/useDisplayStream';
import { useFrameGrabber } from '@/composables/useFrameGrabber';
import { useCaptureLoop } from '@/composables/useCaptureLoop';
import type { RegionKey, RegionRect } from '@/types/calibration';
import { useRecordStore } from '@/stores/record';
import { useStreamStore } from '@/stores/stream';
import { useCalibrationStore } from '@/stores/calibration';
import { useTemplatesStore } from '@/stores/templates';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { screenKeyFromBrowser } from '@/utils/screenKey';
import { isRectValid } from '@/types/calibration';
import StepGuide from '@/components/StepGuide.vue';
import ScreenSourcePicker from '@/components/ScreenSourcePicker.vue';
import PreviewCanvas from '@/components/PreviewCanvas.vue';
import ExpCard from '@/components/ExpCard.vue';
import GoldCard from '@/components/GoldCard.vue';
import RateComparePanel from '@/components/RateComparePanel.vue';
import RecordControls from '@/components/RecordControls.vue';

const router = useRouter();
const display = useDisplayStream({ autoDisconnectOnUnmount: false });
const grabber = useFrameGrabber();
const record = useRecordStore();
const streamStore = useStreamStore();
const calibration = useCalibrationStore();
const templates = useTemplatesStore();
const settings = useSettingsStore();
const ui = useUiStore();

/** 采集 Worker 句柄。 */
const worker = ref<Worker | null>(null);

/** 采集节拍序号（自开始递增，供 `shouldReadLevel` 节奏判定）。 */
let tickSeq = 0;

/** 采集循环（把 store/composable 状态以函数形式注入）。 */
const loop = useCaptureLoop({
  grabber: () => grabber.grabber.value,
  calibration: () => calibration.config,
  bank: () => templates.activeBank,
  session: () => record.currentSession,
  recordStartedAt: () => record.startedAt,
  onFrame: (r) => {
    // 把单帧结果灌回 store（更新实时快照与 notices）。
    record.applyFrame({
      readState: r.readState,
      changedMetrics: r.changedMetrics,
      notices: r.notices,
      ingest: r.ingest,
    });
  },
});

/** 是否已完成必填校准。 */
const calibrated = computed<boolean>(() => calibration.requiredLocated);

/** 步骤 1：是否已连接共享流。 */
const step1Done = computed<boolean>(() => display.connected.value);
/** 步骤 2：是否已校准。 */
const step2Done = computed<boolean>(() => calibrated.value);
/**
 * 步骤 3：是否已开始过记录。
 *
 * 注意：`record` 是 Pinia store，其 `ref`/`computed` 在 store 边界**已自动解包**，
 * 因此访问时**不再写 `.value`**（`record.status` 即为 `RecordStatus` 值）。
 */
const step3Done = computed<boolean>(() => record.status !== 'idle');

/** 当前激活步骤（1-based）。 */
const activeStep = computed<number>(() => {
  if (!step1Done.value) return 1;
  if (!step2Done.value) return 2;
  return 3;
});

/** 经验卡置灰：发生任何警告态读数时。（store 属性已解包，不写 `.value`） */
const expMuted = computed<boolean>(() => record.readState === 'interrupted');

/**
 * 请求连接共享画面。
 */
async function onConnect(): Promise<void> {
  const ok = await display.connect();
  if (ok) {
    grabber.attach(display.video.value);
    const key = screenKeyFromBrowser(display.dimensions.value.width, display.dimensions.value.height);
    streamStore.setConnected(display.stream.value as MediaStream, display.video.value, display.dimensions.value);
    await calibration.load(key);
    ui.pushToast('已连接共享画面', 'success');
  } else {
    streamStore.setError(display.error.value ?? '连接失败');
    ui.pushToast(display.error.value ?? '连接共享画面失败', 'error');
  }
}

/**
 * 断开共享画面。
 */
function onDisconnect(): void {
  stopWorker();
  display.disconnect();
  streamStore.disconnect();
  ui.pushToast('已断开共享画面', 'info');
}

/** 启动采集 Worker。 */
function startWorker(): void {
  const w = worker.value;
  if (!w) return;
  tickSeq = 0;
  w.postMessage({ type: 'start', fps: settings.captureFps });
}

/** 停止采集 Worker。 */
function stopWorker(): void {
  const w = worker.value;
  if (!w) return;
  w.postMessage({ type: 'stop' });
}

/**
 * 处理 Worker 消息。
 *
 * @param event worker message 事件。
 */
function onWorkerMessage(event: MessageEvent<WorkerToMain>): void {
  const msg = event.data;
  if (msg.type === 'tick') {
    loop.onTick(tickSeq);
    tickSeq += 1;
  }
}

/** 开始记录。 */
function onStart(): void {
  if (!display.connected.value) {
    ui.pushToast('请先连接共享画面', 'warning');
    return;
  }
  const clientInfo: ClientInfo = {
    width: display.dimensions.value.width,
    height: display.dimensions.value.height,
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    calibVersion: calibration.config.version,
  };
  const ok = record.start({ clientInfo, levelCalibrated: calibration.requiredLocated });
  if (!ok) {
    ui.pushToast('无法开始记录（已有进行中的会话）', 'warning');
    return;
  }
  loop.reset();
  startWorker();
  ui.pushToast('开始记录', 'success');
}

/** 暂停记录。 */
function onPause(): void {
  if (record.pause()) ui.pushToast('已暂停', 'info');
}

/** 继续记录。 */
function onResume(): void {
  if (record.resume()) ui.pushToast('已继续', 'info');
}

/** 结束记录（异步落库）。 */
async function onFinish(): Promise<void> {
  stopWorker();
  const rec = await record.finish();
  if (rec) {
    ui.pushToast(`已保存记录（净经验 ${rec.netExp === null ? '未确认' : rec.netExp}）`, 'success');
  } else {
    ui.pushToast('结束记录失败', 'error');
  }
}

/**
 * 处理预览层上报的区域矩形（面板页不框选，仅透传；此处保留以复用 PreviewCanvas 契约）。
 *
 * @param key 区域键。
 * @param rect 归一化矩形。
 */
function onRegionUpdate(key: RegionKey, rect: RegionRect): void {
  if (!isRectValid(rect)) return;
  calibration.setRegionRect(key, rect);
}

/** 跳转到校准页。 */
function goCalibration(): void {
  void router.push('/calibration');
}

/** 采集帧数（诊断展示）。 */
const processedFrames = computed<number>(() => loop.processedFrames.value);

watch(
  () => settings.captureFps,
  (fps) => {
    const w = worker.value;
    if (w && record.isRecording) w.postMessage({ type: 'setFps', fps });
  },
);

onMounted(async () => {
  // 预载设置与模板库（幂等）。
  await settings.load();
  await templates.load();
  // 初始化 Worker。
  if (typeof Worker !== 'undefined') {
    const w = new CaptureWorker();
    w.addEventListener('message', onWorkerMessage);
    worker.value = w;
  }
});

onBeforeUnmount(() => {
  stopWorker();
  const w = worker.value;
  if (w) {
    w.removeEventListener('message', onWorkerMessage);
    w.terminate();
    worker.value = null;
  }
  display.disconnect();
});
</script>

<template>
  <div class="panel-view">
    <header class="panel-view__intro">
      <h1 class="panel-view__title">控制面板</h1>
      <p class="panel-view__subtitle">
        记录本次升级效率，游戏画面仅在当前设备处理（纯本地，不上传）。
      </p>
    </header>

    <StepGuide
      :step1-done="step1Done"
      :step2-done="step2Done"
      :step3-done="step3Done"
      :active-step="activeStep"
    />

    <div class="panel-view__grid">
      <div class="panel-view__col panel-view__col--left">
        <ScreenSourcePicker
          :phase="display.phase.value"
          :width="display.dimensions.value.width"
          :height="display.dimensions.value.height"
          :error="display.error.value"
          :ended-by-user="display.endedByUser.value"
          @connect="onConnect"
          @disconnect="onDisconnect"
        />
        <PreviewCanvas
          :width="display.dimensions.value.width"
          :height="display.dimensions.value.height"
          :video-el="display.video.value"
          :overlay="false"
        />
      </div>

      <div class="panel-view__col panel-view__col--right">
        <ExpCard
          :level-info="record.levelInfo"
          :net-exp="record.netExp"
          :exp-per-hour="record.expPerHour"
          :tier="record.lastRecord?.efficiencyTier ?? null"
          :muted="expMuted"
          muted-hint="采集连续性中断，部分数值可能陈旧，请保持游戏画面可见"
        />
        <GoldCard
          :gold-start="record.lastRecord?.goldStart ?? null"
          :gold-now="record.lastRecord?.goldEnd ?? null"
          :gold-per-hour="record.goldPerHour"
          :muted="expMuted"
          muted-hint="数据可信度降低"
        />
        <RateComparePanel :rate="record.rate" :read-state="record.readState" />
        <RecordControls
          :status="record.status"
          :saving="record.saving"
          :stream-ready="display.connected.value"
          :calibrated="calibrated"
          @start="onStart"
          @pause="onPause"
          @resume="onResume"
          @finish="onFinish"
        />
        <div class="panel-view__actions">
          <button type="button" class="panel-link" @click="goCalibration">前往识别校准 →</button>
          <span class="panel-view__diag">已处理帧：{{ processedFrames }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-view__title {
  margin: 0;
  font-size: 20px;
  color: #303133;
}

.panel-view__subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: #909399;
}

.panel-view__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

@media (max-width: 980px) {
  .panel-view__grid {
    grid-template-columns: 1fr;
  }
}

.panel-view__col {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-view__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-link {
  border: none;
  background: transparent;
  color: #b45309;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}

.panel-view__diag {
  font-size: 12px;
  color: #a8abb2;
}
</style>
