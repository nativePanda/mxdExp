# 经验记录 —— 冒险岛经验统计工具（maple_exp_tracker）

一个**完全跑在本地浏览器**里的冒险岛（MapleStory）升级效率记录器：共享游戏画面即可自动读取经验与金币，实时算出经验/小时、金币/小时，并沉淀可回溯的历史记录。

> 纯前端 · 纯本地 · **数据不上传** · 无服务端

---

## ⚠️ 必须通过 http://localhost 访问

本工具依赖浏览器的 **屏幕共享 API**（`navigator.mediaDevices.getDisplayMedia`），该 API 只在**安全上下文（Secure Context）**下可用。

- ✅ `http://localhost` / `http://127.0.0.1` —— 可用
- ✅ `https://` —— 可用
- ❌ 直接用 `file://` 打开 `index.html` —— **不可用**（`mediaDevices` 为 `undefined`）
- ❌ 用局域网 IP 访问（如 `http://192.168.x.x`）—— **不可用**

因此请**始终使用 `npm run dev` 启动的 localhost 地址**访问，不要用 `file://` 打开构建产物。

> 若必须用 `file://` 或 IP 访问，可临时让 Chrome/Edge 将地址标记为可信来源，但**不推荐**。

---

## 运行环境要求

| 项 | 要求 |
| --- | --- |
| 浏览器 | **Chrome / Edge 最新版**（推荐 Chrome） |
| Node.js | ≥ 18（开发用，推荐 20 / 22 LTS） |
| 网络 | 运行时**不需要**联网；仅首次 `npm install` 需要 |

---

## 开发与构建命令

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器（默认 http://localhost:5173）
npm run dev

# 3. 类型检查（vue-tsc，零错误为通过标准）
npm run typecheck

# 4. 生产构建（先类型检查再打包，产物在 dist/）
npm run build

# 5. 仅打包，跳过类型检查（调试用）
npm run build:only

# 6. 本地预览构建产物（同样通过 localhost 访问）
npm run preview

# 7. 运行单元测试（vitest）
npm run test
npm run test:watch   # watch 模式
```

> **类型检查建议跑两遍**：除 `npm run typecheck`（vue-tsc）外，再跑一次裸 `npx tsc -p tsconfig.app.json --noEmit`。
> 原因是 **vue-tsc 通过不代表可构建**——曾出现 vue-tsc 未拦截、但 Rollup 报 `not exported` 的真实问题。
> `npm run build` 会同时执行 `vue-tsc --noEmit && vite build`，因此最终以 `build` 为准。

---

## 使用流程（三步引导）

控制面板采用**三步引导**（`StepGuide`），按顺序完成即可开始记录：

1. **选择游戏窗口** —— 在「控制面板」点击「共享游戏窗口」，在浏览器弹窗中选中冒险岛窗口（`getDisplayMedia`）。
2. **完成识别校准** —— 进入「识别校准」页，框选 6 个区域（经验条 / 经验数值 / 等级 / 金币 / HP / MP），**框好后点击「保存校准」**。
3. **开始记录** —— 回到「控制面板」，点击「开始记录」，实时查看经验/小时、金币/小时、速率对比等指标。

> ⚠️ **校准不会自动保存**：拖动框只改内存，必须点「保存校准」才落库。别忘了最后那一下。
> 详细步骤见 [`docs/calibration-guide.md`](docs/calibration-guide.md)。

记录结束后会自动保存到本机 IndexedDB，可在「历史记录」页查看、导出或导入。

> **注意：校准页在未连接共享画面时是空状态。** 画面共享由「控制面板」独占负责，校准页**不会**自己再次弹出共享请求（避免重复弹窗）。
> 因此若先打开校准页会看到提示「请先回到控制面板选择游戏窗口」——这是**预期行为，不是 bug**。请先在控制面板完成第 1 步。

---

## 页面与路由（hash 模式）

路由使用 **hash history**（`createWebHashHistory`），所以地址形如 `http://localhost:5173/#/panel`。共 5 个页面：

| 页面 | URL（hash 路径） | 说明 |
| --- | --- | --- |
| 控制面板 | `http://localhost:5173/#/panel` | 窗口共享 + 三步引导 + 实时指标（默认页） |
| 识别校准 | `http://localhost:5173/#/calibration` | 6 区域框选 + 字形模板向导 |
| 历史记录 | `http://localhost:5173/#/history` | 记录列表、导出 / 导入 |
| 更新日志 | `http://localhost:5173/#/changelog` | 版本变更说明 |
| 设置 | `http://localhost:5173/#/settings` | 采集频率、阈值等 |

> ⚠️ **新手最常见的踩坑点**：请务必带上 `#`。
> 直接访问 `http://localhost:5173/calibration`（把路径写在 `#` 之前）会被**未匹配路由回落规则** `/:pathMatch(.*)*` 重定向回 `#/panel`，看起来像"校准页打不开"。
> 正确写法是 `#/calibration`。纯本地静态应用采用 hash 模式，正是为了让刷新 / 直接打开都不易 404。

---

## 采集原理与关键设计决策

### 1. 采集由 Web Worker 定时器驱动（不是 `requestAnimationFrame`）

这是**刻意的设计决策**，不是偶然：

- `requestAnimationFrame`（rAF）在标签页切到后台时**完全停摆**——后台 0 帧，采集直接中断；
- 主线程 `setInterval`：前 5 分钟尚能保持约 1Hz，但**标签页隐藏超过 5 分钟会塌到约每分钟 1 次**（浏览器后台节流）；
- **Web Worker 内的定时器按规范豁免后台节流**，是唯一正确的采集驱动。

因此 `src/workers/capture.worker.ts` 负责按 `fps` 周期发送 `tick`，主线程收到 tick 后同步抓帧；若上一帧尚未处理完则**丢弃本帧、不排队**（见 `processFrame` / `shouldDropFrame`）。
Worker 只发 tick，不碰 DOM、不碰 store，节奏与业务解耦。

### 2. 活动时长按「真实时间跨度」计算

`expPerHour` 等所有速率一律用 **`deltaExp / deltaMs`（真实时间）** 计算，**绝不用帧数推算**——因为后台节流会掉帧，用帧数会算错。相关纯函数见 `src/core/metrics/expPerHour.ts`。

### 3. 拒识一律返回 `null`（"未知"）

识别失败时**绝不返回猜测值**，统一返回 `null` 表示"未知"；UI 上显示为「—」并置灰，避免污染统计。

### 4. 校准为 6 个区域

| RegionKey | 含义 | 消费者 | 必填 | 默认联动 |
| --- | --- | --- | --- | --- |
| `expBar` | 经验条填充区 | 像素比例（`columnProfile`） | ✅ | 与 `expText` 同矩形 |
| `expText` | 经验数值文字 | 数字识别（`readDigits`） | ✅ | 与 `expBar` 同矩形 |
| `level` | 等级数字 | 数字识别 | ➖ 选填 | — |
| `gold` | 金币数值 | 数字识别 | ✅ | — |
| `hp` | HP 数值 | 数字识别 | ➖ 选填 | — |
| `mp` | MP 数值 | 数字识别 | ➖ 选填 | — |

- **`expBar` 与 `expText` 默认共享同一矩形**：由开关 `expSplit` 控制——`expSplit=false`（默认）时两者取同一矩形、**同帧复用**（只抓一次帧），`expSplit=true` 时各自抓帧（当数值文字与经验条不在同一位置时开启）。
- 坐标为**相对画面的 0–1 比例**（不是像素），相对**原始视频尺寸**；**分辨率变化后需重新标定**。

### 5. 识别原理简版

- **经验条（比例）**：校准框 → **逐列中值剖面**（`columnProfile`）→ **Otsu 二值化** → 跨帧 **2D 中值**（环形缓冲 `FRAME_N` 帧）→ 由剖面算出填充比例。跨帧中值可抗高光 / 闪烁。
- **数字（数值）**：**固定字体字形模板匹配**（分割 → 归一化 → **NCC** 相关），**不用通用 OCR**。实测 Tesseract 单张需 5~15 秒，与每秒 1 次的采集频率严重冲突，故自建字形模板库（`TemplateBank`）。
  > 当前 P0 的「字形模板向导」只支持**查看覆盖 / 重建内置模板库（Canvas 渲染）/ 清除自定义 / 切换内置与自定义**；**「用真实游戏画面逐字符重采」属 P1，尚未接入采集入口**（向导内已如实说明）。

### 6. 双源交叉校验

经验条（像素比例）与经验数值（文字读数）**互相校验**：任一异常时按拒识处理，双源一致时才提升置信度。

---

## 隐私声明

- **游戏画面仅在当前设备（浏览器内存）中处理**，不落盘、不上传。
- 所有数据（历史记录、采样点、校准配置、设置）**仅保存在本机 IndexedDB / localStorage**。
- 运行时**不发起任何外部网络请求**。

---

## 目录结构（真实实现）

```
maple_exp_tracker/
├── index.html
├── package.json
├── vite.config.ts
├── vitest.config.ts
├── tsconfig*.json
├── tailwind.config.ts
├── postcss.config.js
├── env.d.ts
└── src/
    ├── main.ts                     # 应用入口
    ├── App.vue                     # 根组件（顶部 tab + router-view）
    ├── router/index.ts             # 5 个路由 + hash history + TABS 定义
    ├── styles/                     # main.css / element-override.css
    ├── types/                      # enums / models / calibration / vision / messages / ipc / index
    ├── constants/                  # appSettings / defaults / perf / regions / texts / thresholds
    ├── utils/                      # format / uuid / screenKey / json / download / diag
    ├── db/                         # Dexie：database / recordsRepo / samplesRepo /
    │                               #   calibrationRepo / expTableRepo / kvRepo / index
    ├── stores/                     # 8 个 Pinia store：record / settings / calibration /
    │                               #   history / expTable / templates / stream / ui
    ├── composables/
    │   ├── useCaptureLoop.ts       # ★ 主采集管线（纯函数 processFrame 等）
    │   ├── useDisplayStream.ts     # getDisplayMedia 屏幕共享
    │   ├── useFrameGrabber.ts      # 离屏 canvas 抓帧
    │   ├── useRecordSession.ts     # 会话编排
    │   ├── useAutoCalibrate.ts     # 自动校准
    │   └── usePageVisible.ts       # 页面可见性
    ├── core/                       # ★ 识别内核（纯 TS，无 DOM 依赖，可单测）
    │   ├── vision/                 # 12 文件：color / otsu / profile / ratio / binarize /
    │   │                           #   segment / normalize / ncc / templateBank /
    │   │                           #   readDigits / glyphSource / index
    │   ├── estimator/              # 4 文件：rangeFromReading / ExpRequirementEstimator / guards / index
    │   ├── metrics/                # 7 文件：expPerHour / rateCompare / segments /
    │   │                           #   efficiencyTier / levelProgress / discontinuity / index
    │   └── record/                 # 4 文件：RecordSession / confirmGate / recordMachine / index
    ├── components/                 # 16 个组件（见下）
    ├── views/                      # PanelView / CalibrationView / HistoryView /
    │                               #   SettingsView / ChangelogView
    └── workers/
        ├── capture.worker.ts       # Web Worker 定时器驱动采集
        ├── recognize.worker.ts     # P0 仅接口占位
        └── README.md
```

**`src/components/`（16 个）**：`CalibrationOverlay` / `EfficiencyTierTag` / `EmptyState` / `ExpCard` / `GlyphWizardDialog` / `GoldCard` / `PreviewCanvas` / `RateComparePanel` / `ReadStateBadge` / `RecordControls` / `RecordListItem` / `RegionList` / `ScreenSourcePicker` / `StatTile` / `StepGuide` / `TrendChart`。

> `TrendChart` 为**原生 SVG 实现**（不引入第三方图表库）。

---

## 开发进度 / 模块状态

| 模块 | 位置 | 状态 | 说明 |
| --- | --- | --- | --- |
| 识别内核 · 像素/比例 | `src/core/vision/` | ✅ 已实现 | Otsu 二值化、列剖面、跨帧中值、比例解算 |
| 识别内核 · 数字识别 | `src/core/vision/` | ✅ 已实现 | 分割 → 归一化 → NCC 字形模板匹配 |
| 识别内核 · 经验需求估算 | `src/core/estimator/` | ✅ 已实现 | 由读数估算本级升级所需经验 |
| 识别内核 · 指标计算 | `src/core/metrics/` | ✅ 已实现 | 经验/小时、速率对比、效率档位、等级进度、不连续检测 |
| 识别内核 · 记录状态机 | `src/core/record/` | ✅ 已实现 | `RecordSession` / `confirmGate` / `recordMachine` |
| 采集管线 | `src/composables/` + `src/workers/` | ✅ 已实现 | Worker 定时器驱动、抓帧、单帧管线 `processFrame` |
| 数据层（持久化） | `src/db/` | ✅ 已实现 | Dexie：记录 / 采样点 / 校准 / 经验表 / KV |
| 状态管理 | `src/stores/` | ✅ 已实现 | 8 个 Pinia store |
| UI 组件 | `src/components/` | ✅ 已实现 | 16 个组件 |
| 视图页面 | `src/views/` | ✅ 已实现 | 5 个页面，懒加载分包 |

> 说明：`recognize.worker.ts` 在 P0 阶段仅保留接口占位（识别当前在主线程完成）；数字识别的通用 OCR 兜底为后续可选能力，当前未启用，运行时不发起任何外部请求。

---

## 测试与校验现状

- **单元测试**：`npm run test` 当前 **184 个用例全部通过**，分布在 **12 个测试文件**，覆盖识别内核（比例 / 数字）、估算器、指标、记录状态机、常量与 store 工具等。
- **类型检查**：`npm run typecheck`（vue-tsc）零错误；另建议跑裸 `npx tsc -p tsconfig.app.json --noEmit`。
- **构建**：`npm run build` 已验证可成功产出（约 1740 个模块，5 个 view chunk 懒加载分包）。

---

## 常见问题

**Q：点击「共享游戏窗口」没有反应 / 报错 `mediaDevices is undefined`？**
A：确认你是通过 `http://localhost` 访问的（而不是 `file://`），且浏览器为 Chrome/Edge。

**Q：直接访问 `/calibration` 打不开、总是跳回控制面板？**
A：路由用 hash 模式，请带上 `#`——正确地址是 `.../#/calibration`。不带 `#` 会被未匹配路由回落规则重定向到 `#/panel`。

**Q：先打开「识别校准」页，却提示「请先回到控制面板选择游戏窗口」？**
A：这是**预期行为**。画面共享只在「控制面板」发起，校准页复用该共享流、不会重复弹窗。请先在控制面板完成窗口共享。

**Q：共享后画面是黑屏？**
A：部分游戏使用独占全屏或硬件加速，需将游戏改为**窗口化/无边框窗口**模式再共享。

**Q：切到后台后数据不更新了？**
A：浏览器对后台标签页有节流策略。得益于 Web Worker 定时器与「按真实时间戳计算」，经验/小时 等**长窗口速率不受影响**；但「近 60 秒」这类短窗口速率会失真。建议保持本工具标签页在前台。

**Q：识别不准怎么办？**
A：进入「识别校准」页框选正确的区域并**点击「保存校准」**；确认框位贴住目标、无遮挡，且未更换过分辨率。若数字识别置信度偏低，可打开「字形模板向导」**重建内置模板库**或切换模板来源（注：用真实游戏画面逐字符重采属 P1，尚未接入）。详见 [`docs/calibration-guide.md`](docs/calibration-guide.md)。
