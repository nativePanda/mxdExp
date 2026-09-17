<script setup lang="ts">
/**
 * GlyphWizardDialog —— 字形模板采集向导。
 *
 * ## 能力（P0 范围，如实标注）
 * 1. **查看当前生效模板库**的字形覆盖情况（哪些字符已收录，`TemplateBank` 的 `keys()`）；
 * 2. **重建内置默认模板库**（用 Canvas `fillText` 渲染，覆盖 `KV_KEYS.defaultTemplates`）；
 * 3. **清除自定义模板库**（回退到内置）；
 * 4. **切换**启用内置 / 自定义模板库。
 *
 * ## 不在 P0 范围（诚实说明）
 * 「用真实游戏画面逐字符重采字形」需要人工逐字符定位分割，属 P1；
 * 本向导不伪造该能力，仅在置信度偏低时（见 `TEXTS.LOW_CONFIDENCE_HINT`）引导用户
 * 到本向导切换/重建模板库。
 *
 * 说明：模板库对象（`TemplateBank`）由 `templates` store 持有；本组件通过属性接收
 * 只读快照（字符列表 / 计数 / 当前来源），通过事件请求重建 / 清除 / 切换，
 * 避免组件直接触碰浏览器 Canvas 与持久化细节。
 */
import { computed } from 'vue';
import { DEFAULT_GLYPH_CHARS } from '@/core/vision';
import { TEXTS } from '@/constants/texts';

const props = withDefaults(
  defineProps<{
    /** 是否可见（受控）。 */
    modelValue: boolean;
    /** 当前生效模板库已收录的字符（升序去重）。 */
    activeChars: string[];
    /** 内置模板库字符数（`0` 表示未构建）。 */
    defaultCount: number;
    /** 自定义模板库字符数（`0` 表示无）。 */
    customCount: number;
    /** 是否启用自定义模板库。 */
    useCustom: boolean;
    /** 是否正在重建。 */
    busy?: boolean;
  }>(),
  { busy: false },
);

const emit = defineEmits<{
  /** 显示状态变更。 */
  (e: 'update:modelValue', v: boolean): void;
  /** 请求重建内置模板库。 */
  (e: 'rebuild-default'): void;
  /** 请求清除自定义模板库。 */
  (e: 'clear-custom'): void;
  /** 请求切换启用自定义模板库。 */
  (e: 'set-use-custom', v: boolean): void;
}>();

/** 期望字符集（内置默认）。 */
const expectedChars = computed<string[]>(() => DEFAULT_GLYPH_CHARS.split(''));

/** 缺字列表（期望但未收录）。 */
const missingChars = computed<string[]>(() =>
  expectedChars.value.filter((c) => !props.activeChars.includes(c)),
);

/** 低置信度提示文案。 */
const lowConfHint = TEXTS.LOW_CONFIDENCE_HINT;

/** 关闭。 */
function close(): void {
  emit('update:modelValue', false);
}

/** 当前来源文案。 */
const sourceText = computed<string>(() => {
  if (props.useCustom && props.customCount > 0) return `自定义模板库（${props.customCount} 字形）`;
  if (props.defaultCount > 0) return `内置默认模板库（${props.defaultCount} 字形）`;
  return '尚未构建模板库';
});
</script>

<template>
  <div v-if="modelValue" class="glyph-wizard" role="dialog" aria-modal="true">
    <div class="glyph-wizard__mask" @click="close" />
    <div class="glyph-wizard__panel">
      <header class="glyph-wizard__head">
        <h3 class="glyph-wizard__title">字形模板向导</h3>
        <button type="button" class="glyph-wizard__close" @click="close">✕</button>
      </header>

      <section class="glyph-wizard__section">
        <div class="glyph-wizard__row">
          <span class="glyph-wizard__label">当前来源</span>
          <span class="glyph-wizard__value">{{ sourceText }}</span>
        </div>
        <div class="glyph-wizard__row">
          <span class="glyph-wizard__label">已收录字符</span>
          <span class="glyph-wizard__value glyph-wizard__chars">
            <template v-if="activeChars.length > 0">
              <span v-for="c in activeChars" :key="c" class="glyph-chip">{{ c }}</span>
            </template>
            <span v-else>—</span>
          </span>
        </div>
        <div v-if="missingChars.length > 0" class="glyph-wizard__row">
          <span class="glyph-wizard__label">缺失字符</span>
          <span class="glyph-wizard__value glyph-wizard__chars">
            <span v-for="c in missingChars" :key="c" class="glyph-chip glyph-chip--missing">{{ c }}</span>
          </span>
        </div>
      </section>

      <p class="glyph-wizard__hint">{{ lowConfHint }}</p>
      <p class="glyph-wizard__note">
        说明：P0 仅支持「重建内置模板库」与「内置/自定义切换」；用真实游戏画面逐字符
        重采（自定义模板）属 P1，届时在此增加采集入口。
      </p>

      <footer class="glyph-wizard__actions">
        <button
          type="button"
          class="gw-btn gw-btn--primary"
          :disabled="busy"
          @click="emit('rebuild-default')"
        >
          {{ busy ? '重建中…' : '重建内置模板库' }}
        </button>
        <button
          type="button"
          class="gw-btn"
          :disabled="useCustom"
          @click="emit('set-use-custom', true)"
        >
          启用自定义
        </button>
        <button
          type="button"
          class="gw-btn"
          :disabled="!useCustom"
          @click="emit('set-use-custom', false)"
        >
          回退内置
        </button>
        <button
          type="button"
          class="gw-btn gw-btn--danger"
          :disabled="customCount === 0 || busy"
          @click="emit('clear-custom')"
        >
          清除自定义
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.glyph-wizard {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.glyph-wizard__mask {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 40%);
}

.glyph-wizard__panel {
  position: relative;
  width: min(560px, 92vw);
  max-height: 86vh;
  overflow: auto;
  padding: 20px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgb(0 0 0 / 20%);
}

.glyph-wizard__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.glyph-wizard__title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #303133;
}

.glyph-wizard__close {
  border: none;
  background: transparent;
  font-size: 16px;
  color: #909399;
  cursor: pointer;
}

.glyph-wizard__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: #fafafa;
  border-radius: 8px;
}

.glyph-wizard__row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.glyph-wizard__label {
  flex: 0 0 84px;
  font-size: 12px;
  color: #909399;
}

.glyph-wizard__value {
  flex: 1;
  font-size: 13px;
  color: #303133;
}

.glyph-wizard__chars {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.glyph-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 4px;
  border-radius: 4px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 12px;
  font-weight: 600;
}

.glyph-chip--missing {
  background: #fef3c7;
  color: #b45309;
}

.glyph-wizard__hint {
  margin: 12px 0 4px;
  font-size: 12px;
  color: #b45309;
}

.glyph-wizard__note {
  margin: 0 0 12px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

.glyph-wizard__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.gw-btn {
  padding: 7px 14px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #ffffff;
  color: #606266;
  font-size: 13px;
  cursor: pointer;
}

.gw-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.gw-btn--primary {
  background: #f59e0b;
  border-color: #f59e0b;
  color: #ffffff;
}

.gw-btn--danger {
  color: #dc2626;
  border-color: #fca5a5;
}
</style>
