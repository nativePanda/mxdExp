# 冒险岛经验统计工具 —— 技术预研报告

> 项目：本地版「冒险岛经验统计工具」（参考枫记 https://fj.need.run/）
> 技术栈（已定）：Vite + Vue 3 + Element Plus，纯前端、纯本地、数据不上传
> 预研人：架构师 高见远
> 日期：2026-09-17
> 实验环境：Node v22.22.2 / npm 10.9.7 / Chrome（headless new）/ Windows
> 实验脚本与产物：`D:\test\exp\probe\`，原始输出见 `probe\out\*.txt|json`

---

## 0. 结论速览（TL;DR）

| 问题 | 结论 | 可行性 |
|------|------|--------|
| **Q1 经验条像素比例** | 用「校准框定 0~100% + 逐列中值剖面 + Otsu + 跨帧 2D 中值」可稳定到 **±0.5px（400px 条 = ±0.125% 经验）**。**必须做跨帧 2D 中值**，否则高光扫过会让单帧读数直接报废 | ✅ 可行 |
| **Q2 数字文字识别** | **P0 用「固定字体数字模板匹配」**（分割+归一化+NCC），实测干净样本 **6/7 通过**、噪声幅度 ≤40 全过、±3px 平移全过、**2~4 倍缩放全过**、单字形 11/11 全对。Tesseract.js 作为 P2 兜底（非首选） | ✅ 首选模板匹配 |
| **Q3 交叉校验** | **强烈推荐照搬枫记的 `rangeFromReading` 算法**：由 (数值,比例) 反推「本级所需经验」区间，多帧取交集。实测 3 帧即收敛到 `[977416, 977526]`（真值 977471 在内，宽仅 110） | ✅ 可行且优雅 |
| **Q4 采集调度** | **`setInterval` 在 Worker 里跑**。实测：**后台标签页 rAF = 0 帧**（完全停摆），`setInterval`/Worker 保持 ~1Hz；但**后台 >5 分钟会被压到 1 次/分钟**。必须用 Worker + 时间戳补偿 + 掉帧提示 | ⚠️ 可行但有硬约束 |
| **Q5 持久化** | **IndexedDB + Dexie 4.x**（与参考站一致：枫记用的就是 `dexie@4.4.5`）。校准配置 ≤ 几 KB 也可放 localStorage，但历史记录必须 IndexedDB | ✅ 可行 |
| **Q6 等级经验表** | 数据**有公开来源**（怀旧冒险岛资料库 mxdzlk.com/experience-table，含国服怀旧服/CMS079/GMS083/TMS113）。**更妙的是：算法可自举**——不需要预算表，靠读数反推即可收敛 | ✅ 可行 |

### ⚠️ 最大风险（必读）
1. **浏览器后台节流是硬约束**。用户「游戏全屏在前台、浏览器切后台」时，5 分钟后采样率会掉到 1 次/分钟。**经验/小时 依然可算**（因为是用时间戳算的），但「近 60 秒速率」会失真。缓解：Worker 定时器 + 音轨保活 + 明确 UI 提示。
2. **高光是像素法的天敌**。经验条上的高光扫过会让**单帧**读数从 50% 跳到 100%。**唯一有效解法是跨帧 2D 中值**（实测误差 0.0px）。这条必须写进实现规范。
3. **模板匹配依赖「字体固定」**。若游戏换字体/加粗/国际服字体不同，需要用户重新采样模板（提供「模板采集」校准流程）。
4. **文字读取不是万能的**。若经验条区域被技能特效完全遮挡、或文字被遮挡，务必降级为「按比例估算」并明确标注 `approximate`（参考站也是这么做的）。

---

## 1. 关键技术验证：我们从参考站反推到了什么

### 1.1 枫记的真实技术栈（从线上产物反推，非猜测）

抓取 `fj.need.run` 首页与设置页 HTML，确认其技术选型：

```html
vue@3.5.42 / vue-router@5.3.0 / pinia@4.0.3 / vue-i18n@11.4.10
dexie@4.4.5        <- IndexedDB 封装（直接回答 Q5）
uplot@1.6.32       <- 折线图（轻量、适合高频更新）
element-plus@2.14.5 <- 与本项目目标一致
/assets/exp-requirement-estimator-*.js  <- 等级经验自举算法（独立 chunk）
```

> 结论：**参考站也是 Vue3 + Element Plus + Dexie + uPlot**。我们技术栈选型与其高度一致，风险低。图表库建议直接对齐用 **uPlot**（比 ECharts 轻得多，适合"每秒更新一次"的实时折线）。

### 1.2 反推到的「等级经验自举算法」（`exp-requirement-estimator` chunk）

我们把枫记的 `exp-requirement-estimator-CFCjRQKp.js` 反混淆后得到了**完整算法**（见 `probe\_estimator_pretty.js`）。核心函数 `rangeFromReading`（反混淆后）：

```
输入: absolute（文字数值）, ratio（像素比例）, precision（百分比小数位）
若 absolute<=0 或 ratio<=0        -> 无有效读数
tol     = 0.5 * 10^(-precision) / 100
rMin    = max(0, ratio - tol)
rMax    = min(1, ratio + tol)
minimum = max(absolute, ceil(absolute / rMax))
maximum = floor(absolute / rMin)
返回 {minimum, maximum}   // 本级所需经验的可行区间
```

再对同一等级的多次读数区间**取交集**，交集唯一则确认该级所需经验。

**这是本次预研最重要的发现**：枫记**并不依赖内置经验表**，而是让工具"边跑边自己学出每级所需经验"。表只是冷启动的加速器。

### 1.3 反推到的失败态语义（原文案 → 技术含义）

| 原文案 | 技术含义 |
|--------|---------|
| 文字无法解析 | 模板匹配置信度低于阈值 → 该帧文字读数作废 |
| 文字数值与血条比例不一致 | `absolute/ratio` 与已知 `requiredExp` 不自洽 → 触发 `rangeFromReading` 校验失败 |
| 缺少有效的界面定位 | 校准框缺失或校准框内检测不到经验条结构 |
| 请保持游戏画面可见 | `document.visibilityState==='hidden'` 或流已中断 |
| 跨级经验缺失 | 升级瞬间经验条归零，一段增量无法确认 → 该段不计入净经验 |
| 校验期间显示上次确认值 | 新读数尚未通过交叉校验，先用 `confirmed` 值顶上 |
| 偏差达到 4% 显示箭头 / 回落 2% 后延迟 1.5 秒隐藏 | 「近 60 秒」vs「全程平均」的 hysteresis 阈值（防抖动） |

---

## 2. Q1：经验条百分比 —— 像素填充比例识别

### 2.1 实验设计

在 `probe\exp1c_expbar.js`、`exp5b_highlight.js`、`exp5c_temporal.js` 中，用 `pngjs` 程序生成模拟经验条（含边框 + 橙黄渐变填充 + 深棕底色），再纯像素分析还原填充比例。

**关键前提修正**：真实工具里，经验条左右边界来自**用户校准框选**，不是每帧从像素里找。因此「校准框 = 条的 0%~100% 映射区间」。

### 2.2 实测结果

**A. 干净样本（条宽 400px，7 行采样中值）**

| 真实比例 | 测得比例 | 误差(px) |
|---------|---------|---------|
| 1% | 1.005% | +0.02 |
| 10% | 10.05% | +0.20 |
| 25.07% | 25.13% | +0.22 |
| 50.01% | 50.00% | −0.04 |
| 61.80% | 61.81% | +0.04 |
| 90.01% | 89.95% | −0.24 |
| 99.37% | 99.25% | −0.49 |

**干净样本最大误差 0.49px**（≈0.12% 经验 @400px）。

**B. 噪声鲁棒性（每通道随机噪点 ±amp）**

| 噪声幅度 | 测得(真值40%) | 误差 |
|---------|--------------|------|
| ±5 | 39.95% | −0.05% (−0.2px) |
| ±15 | 39.95% | −0.05% |
| ±30 | 39.95% | −0.05% |
| ±50 | 39.95% | −0.05% |

**逐列中值 + Otsu 阈值对噪点几乎完全免疫**（每帧测量值一致到小数点后两位）。

**C. 文字覆盖在条上（经验条上的数字）**

| 真实 | 测得 | 误差 |
|------|------|------|
| 30% | 29.90% | −0.4px |
| 50% | 50.00% | 0.0px |
| 70% | 70.10% | +0.4px |
| 90% | 89.95% | −0.2px |

用「逐列取 30 分位」即可把覆盖在条上的白色数字压掉。

**D. ⚠️ 高光扫过（这是最大的坑）**

单帧 mid-row 扫描，高光竖直亮带从 x=0 扫到 x=400：

| 高光位置 | 单帧读数(真值50%) |
|---------|------------------|
| 条外 | 50.00% ✅ |
| 条内任意位置 | **100.00%** ❌（11/12 位置全错） |

| 聚合策略 | 结果 |
|---------|------|
| 帧级中值（24 帧） | 100.000% ❌ |
| 帧级均值（24 帧） | 95.833% ❌ |
| **跨帧逐列 2D 中值** | **50.000% ✅（误差 0.0px）** |
| 丢弃异常帧后再中值 | 50.000% ✅ |

> **结论**：**帧级**（整帧一个标量再聚合）聚合对高光无效，因为多数帧都被污染。**唯一正确做法是「逐列跨帧 2D 中值」**：对每一列 x，收集最近 N 帧（建议 10~20 帧）该列的采样值，取中值，得到一条"干净"的列剖面，再在这条剖面上找填充边界。

### 2.3 推荐算法（Q1 定稿）

```
输入: 校准框 box{x,y,w,h}（用户框选，= 经验条内区 x0..x1 即 0%..100%）
参数: FRAME_N = 12 帧环形缓冲

每帧:
  for dx in 0..box.w-1:
     colVal[dx] = median( fillness(pixel(x,y)) for y in box 高度范围 )   // 单帧列中值
  push colVal 进环形缓冲

每 12 帧或每 1 秒:
  for dx in 0..box.w-1:
     clean[dx] = median( colVal_f[dx] for f in 环形缓冲 )                // 2D 中值（关键）
  thr = Otsu(clean)                                                      // 自适应阈值
  boundary = 从左扫描，最后一个 >= thr 的连续列（允许 1% 空洞容差）
  ratio = boundary / box.w
  若检测到"填充满"（clean 全 >= thr）→ ratio = 1（需特殊标记，Otsu 在 100% 时退化）

fillness(r,g,b) = r - 1.2*b + 0.2*g      // 橙黄填充 vs 深棕底，区分度最大
```

### 2.4 精度对「经验/小时」的影响（定量）

> 假设：条宽 W=400px，本级所需经验 `requiredExp = 977471`（Lv.56 真实值），每小时 100 万经验。

- **1px = 1/400 = 0.250% 经验 = 2444 exp**
- 最坏情况（两次读数朝相反方向各偏 1px）对 /小时 的相对误差：
  `2 × 2444 / 1,000,000 = 0.49%`
- 若能做到 **±0.5px**（本方案实测水平），则最坏 **0.24%**

> **结论：精度完全够用**。经验/小时 的主要误差来源不是像素精度，而是①采样时机（升级瞬间）②后台节流。像素这条线不是瓶颈。

### 2.5 边界情况

| 情况 | 表现 | 处理 |
|------|------|------|
| 经验条 ≈ 0%（<0.1%） | 无法区分"极细填充"与"纯底色" | 结合文字读数；或标记为"接近 0" |
| 经验条 = 100% | Otsu 退化（无底色对照） | 检测"内部无底色列"→ 直接判 100% |
| 高光在条内 | 单帧报废 | **2D 跨帧中值**（已解决） |

---

## 3. Q2：数字文字识别 —— P0 推荐「固定字体模板匹配」

### 3.1 方案对比（含实测）

| 维度 | 模板匹配 | Tesseract.js |
|------|---------|--------------|
| 首屏下载 | **0**（模板可内置，几 KB） | **~7~15 MB**（wasm 3.95~4.74MB + 语言包 2.95~10.4MB） |
| 首次可用耗时 | **即时** | 慢网 6.3s / 中 2.6s / 快 1.4s |
| 单次识别耗时 | **<5ms**（实测 6 字符行 <1ms） | **5~15 秒/张** |
| 对固定字体 UI | **极准**（实测 11/11 字形全对） | 一般（Tesseract 对"装饰字体/低对比度"表现差，官方文档自己也承认） |
| 体积依赖 | 无 | core 30.6MB（未压缩）+ eng 13.9MB（未压缩） |
| 维护成本 | 需维护字形模板 | 无需模板，但需处理 CDN/缓存 |

**实测数据（模板匹配，`probe\exp2d_digits.js`）**

| 测试 | 期望 | 结果 | 判定 |
|------|------|------|------|
| 1,234,567（带千分位） | 完整 | `1,234,567` | ✅ |
| 87%（百分比） | 完整 | `87%` | ✅ |
| 12/34（HP 样式） | 完整 | `12/34` | ✅ |
| 0.05% | 完整 | `0?05%` | ⚠️ 1 位待定 |
| 2048576 | 完整 | `2048576` | ✅ |

| 鲁棒性 | 结果 |
|--------|------|
| 噪声 ±10/±25/±40 | ✅ 全过 |
| 噪声 ±50 以上 | ❌ 全拒识（返回 `?`，**安全失败**） |
| 水平平移 −3~+3px | ✅ 全过（因为先分割再归一化） |
| 缩放不匹配（模板 s3 vs 图 s2/s4） | ✅ 全过（画布归一化） |
| **单字形混淆对**（0-9,%，带噪声 ±20） | **11/11 全对**，最小 margin = 0.22（`0`↔`8`） |

> 关键点：模板匹配的失败是**安全失败**——置信度/margin 不足时返回 `?`（拒识），而不是**给出错误数字**。这对金融级校验很重要（宁可丢一帧，不可算错）。

### 3.2 推荐架构（Q2 定稿）

```
P0：固定字体数字模板匹配（纯 Canvas 像素操作，零依赖）
 1. 用户校准：框选「经验数值区域 / 金币区域 / 等级区域」
 2. 采集模板：让用户截图当前数字，自动切分成 0-9 字形（或内置默认字形 + 允许手工修正）
 3. 运行时每帧：
    a. 裁剪 ROI → 灰度 → 二值化（前景白字，阈值自适应）
    b. 列投影分割字形（谷值分割，允许 1~2px 空洞）
    c. 每个字形裁紧致包围盒 → 缩放填充到固定画布（如 24×32）
    d. 与字形库做 NCC（归一化互相关），取最高分
    e. 置信度 < 0.55 或 top1-top2 margin < 0.03 → 返回 '?'（拒识）
 4. 对 '?' 的字符：本帧读数作废，等下一帧

P2（可选兜底）：Tesseract.js
 仅在「用户无法完成模板采集 / 字体异常 / 需要多语言」时提供，
 明确告知"首次需下载约 7-15MB"，并按 idb-keyval 缓存 wasm + 语言包。
```

**为什么不让 Tesseract 当 P0**：游戏 UI 数字是**固定字体的机器字体、低对比度、带描边**——这恰好是 Tesseract 最不擅长的场景，却是模板匹配最擅长的场景。且 Tesseract 的 5~15s/张 与「每秒 1 次」的采集频率**根本冲突**（会不断堆积任务）。**结论：Tesseract 不适合作为本项目主识别器。**

### 3.3 依赖包清单

| 包 | 用途 | 体积 | 引入建议 |
|----|------|------|---------|
| 无（原生 Canvas + 手写算法） | 模板匹配 | 0 | **P0 必装** |
| （开发期）`pngjs@7` | 仅 Node 侧离线生成/测试模板 | 0.62MB | devDependency |
| `tesseract.js@7` + `tesseract.js-core@6` + `@tesseract.js-data/eng@1` | 兜底 OCR | ~7~15MB 首载 | **P2，动态 import** |

---

## 4. Q3：交叉校验算法 —— 文字 vs 像素比例

### 4.1 核心思想

`当前经验` 有两个独立观测量：
- 文字读数 `absolute`（如 468110）
- 像素比例 `ratio`（如 0.4789）

二者的关系：`absolute ≈ ratio × requiredExp`。于是 `requiredExp ≈ absolute / ratio` 是两个观测量**共同约束**的未知量。

### 4.2 实测（`probe\exp3_validate.js`，直接移植枫记算法）

真值 `requiredExp = 977471`（Lv.56），给 3 帧读数：

| 帧 | 数值 abs | 显示比例 | 反推 requiredExp 区间 | 区间宽 |
|----|---------|---------|---------------------|--------|
| 0 | 120619 | 12.34% | [977068, 977859] | 791 |
| 1 | 468110 | 47.89% | [977368, 977571] | 203 |
| 2 | 860272 | 88.01% | [977416, 977526] | 110 |
| **交集** | | | **[977416, 977526]** | **110** |

- 真值 977471 **落在交集内** ✅
- `pick()`（取区间代表值）= **977471**，与真值**完全一致** ✅

**精度收敛性 vs 百分比小数位**

| UI 百分比小数位 | 交集宽度 |
|---------------|---------|
| 0 位 | 11107 |
| 1 位 | 1110 |
| 2 位 | 110 |
| 3 位 | 11 |

> 结论：**2 位小数百分比 + 3 帧交集**即可把每级所需经验锁到 ±110 以内（相对误差 <0.02%）。对 /小时 计算完全够。

### 4.3 不一致时的判定逻辑（Q3 定稿）

```js
function evaluate(reading, knownRequiredExp, precision = 2):
    if reading 无效 (absolute 或 ratio 为空) → {accepted:false, reason:'文字无法解析'}
    if absolute===0 && ratio===0            → {accepted:true, requiredExp:null}  // 空条

    range = rangeFromReading(reading, precision)
    if range === undefined                  → {accepted:false, reason:'缺少有效的界面定位'}

    if knownRequiredExp !== null:
        if knownRequiredExp in range        → {accepted:true, requiredExp:knownRequiredExp}
        else                                → {accepted:false, reason:'文字数值与血条比例不一致'}

    // 未知 requiredExp：累积候选，多帧取交集
    candidates.push(range)
    shared = intersect(candidates)
    if shared:
        if shared.minimum===shared.maximum  → 确认 requiredExp
        else if 已连续 N 帧（N=3）交集稳定 → 取中点作为 provisional
        → {accepted:true, requiredExp:pick(shared)}
    else:
        candidates = [range]   // 冲突，重开
        → {accepted:false, reason:'等待完整读数'}
```

### 4.4 等级提升（经验条重置）检测

```js
// 规则：同一等级内 (absolute, ratio) 应单调不减
levelUp  = (currentLevel !== prevLevel)
        || (currentAbsolute < prevAbsolute && currentRatio < prevRatio - 2e-4)
```

**但注意**：如果「等级读数」本身也识别失败，只能靠数值突降判断，无法与「换角色/断线重连/切图重载」区分。因此：
- **必须同时读取等级数字**（等级区域校准框），不能只读经验条。
- 升级瞬间那段增量标记为 `跨级经验缺失`，不计入`净经验`，但**不影响 /小时 的长期平均**（用总经验 / 总时长）。

### 4.5 「近 60 秒」vs「全程平均」的 hysteresis（照搬参考站）

```
偏差 = |近60秒速率 - 全程平均| / 全程平均
偏差 >= 4%   → 显示箭头（说明当前效率高于/低于平均）
偏差回落到 <= 2% → 启动 1.5 秒计时器，到时仍 <= 2% 才隐藏箭头
```
这样避免箭头因瞬时抖动反复闪烁。

---

## 5. Q4：采集与调度

### 5.1 rAF vs setInterval —— 实测（`probe\exp4_timer.js` / `exp4b_timer_bg.js`）

headless Chrome，17 秒观测：

| 定时器 | 前台（17s） | 后台标签页（17s） | 后台最后 10s |
|--------|-----------|-----------------|-------------|
| `requestAnimationFrame` | 1045 次（~61Hz） | **0 次** ❌ | **0 次** |
| `setInterval(1000)`（主线程） | 17 次（1Hz） | 15 次 | 11 次（**仍 ~1Hz**） |
| `new Worker(setInterval(1000))` | 16 次（1Hz） | 14 次 | 11 次（**仍 ~1Hz**） |

### 5.2 浏览器后台节流策略（官方，Chrome 88+）

| 阶段 | 触发条件 | 回调检查频率 |
|------|---------|-------------|
| Minimal | 页面可见，或最近 30s 有声音 | 正常调度（4ms 下限） |
| Throttled | 隐藏 < 5 分钟 | **1 秒 1 次** |
| Intensive | **隐藏 > 5 分钟** | **1 分钟 1 次** |

**豁免**：有音频输出、WebSocket、WebRTC 的页面；**Web Worker 定时器按规范豁免节流**。

> **关键结论**：
> - **rAF 在后台彻底停摆 → 绝不能用 rAF 做采集驱动**。
> - `setInterval` 在后台前 5 分钟保持 1Hz，**但 5 分钟后塌缩到 1 次/分钟**。
> - **Worker 定时器不受节流**（规范豁免），是采集驱动的**最优解**。
> - WebSocket / 真实音频播放可让页面留在 "Minimal" 档。

### 5.3 推荐调度方案（Q4 定稿）

```
采集频率：1 Hz（与参考站文案"秒 1 次"一致，合理）
  - 每 1 秒抓一帧到离线 canvas（用 VideoFrame / drawImage）
  - 但对【经验条像素】用 2D 跨帧中值，需要环形缓冲最近 10~20 帧
  - 对【文字】每帧独立识别，拒识则跳过

驱动：Worker 里的 setInterval(1000)
  import Timer from './timer.worker?worker'
  const timer = new Timer()
  timer.onmessage = () => captureOnce()      // 主线程抓帧+识别

时间补偿（必须）：
  - 记录每帧的 performance.now()，/小时 一律用「总经验增量 / 实际时间跨度」
    → 即使掉帧到 1 次/分钟，/小时 仍然正确
  - 「近 60 秒速率」用真实时间窗口（timestamp）计算，不假设帧数

保活（可选，缓解 >5 分钟塌缩）：
  a. Worker 定时器（已做，规范豁免，最有效）
  b. 播放一条真实（非静音）的音频（Audio source 有实际采样值）→ 页面留在 Minimal 档
     ⚠️ 纯静音音轨会被识别为"假音频"而无效
  c. 明确 UI 提示："请保持此标签页在前台，否则采样率会下降"

Page Visibility 处理：
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) 提示用户"采样率可能下降，/小时 仍准确"
    else 立即补采一帧，重置时间基准
  })
```

### 5.4 ⚠️ 关于「每秒 1 次」的再思考

参考站是 1 次/秒。但我们的**像素识别需要跨帧 2D 中值**，1Hz 意味着 10~20 秒才能攒够 10~20 帧。这会导致：
- 经验条比例更新**滞后 10~20 秒**（可接受，因为经验变化慢）
- 但**文字读数**可以每秒更新，用文字做主更新、比例做校验

**建议**：采集 1Hz，但**像素比例**用滚动窗口（最近 12 帧，即最近 12 秒）的 2D 中值；**文字**每帧独立输出。二者结合后在每帧做交叉校验。

---

## 6. Q5：数据持久化

### 6.1 选型

| 方案 | 适用 | 结论 |
|------|------|------|
| `localStorage` | 校准配置（几 KB）、用户偏好 | ✅ 可用（简单键值） |
| `IndexedDB` | 历史记录（可能上百条，每条含多帧采样） | ✅ **必须** |
| `Dexie` | IndexedDB 封装 | ✅ **推荐** |
| `idb` | IndexedDB 封装（更小） | 备选 |

### 6.2 推荐：Dexie 4.x

**理由（有据可依）**：
1. **参考站枫记用的就是 `dexie@4.4.5`**（从其 HTML 反推得到），说明该选型在这个场景已被验证。
2. Vue 3 集成友好：Dexie 是纯 JS，可 `liveQuery` + `useObservable` 轻松接入响应式（`dexie` 的 `liveQuery` 返回 Observable，配合 `@vueuse/rxjs` 或 `shallowRef`）。
3. API 现代，事务、索引、版本迁移齐全。
4. 体积：`dexie@4` min+gz ≈ 30KB，可接受。

**注意**：用 Dexie 需带 **`dexie` + `dexie-export-import`（可选，做导入导出 JSON）**。

### 6.3 数据模型建议

```
DB: mapLogDB (version 1)
  table calibration: { id:'default', regions:{expBar,expText,level,mesos,hp,mp}, keyColor, ... }
  table records:     { id, startedAt, endedAt, durationMs, startLevel, endLevel,
                       netExp, expPerHour, mesosPerHour, mapName, samples:[...] }
  table templates:   { id:'glyph', scale, glyphs:{ '0':ImageData, ... } }   // 可选
  table expTable:    { level, requiredExp, approximate:bool, source:'builtin'|'inferred' }
```

---

## 7. Q6：等级经验表

### 7.1 数据来源（已找到）

**怀旧冒险岛资料库** `https://mxdzlk.com/experience-table` 提供完整的分版本升级经验表：
- 国服冒险岛**怀旧服**（2025-08-03 开服）
- 国服 CMS079（经典 079）
- 国服 CMS086
- 国际服 GMS083
- 台服 TMS113 / 台服经典版 / 流浪岛 NewMaple

**样例数据（CMS079，与怀旧服曲线接近）**：

| 等级 | 升下一级所需经验 |
|------|----------------|
| 1 | 15 |
| 10 | 1,716 |
| 30 | 95,700 |
| 50 | 709,716 |
| 56 | 977,471 |
| 70 | 2,062,925 |
| 100 | 10,223,168 |

（本预研实验用的 977,471 即取自该表 Lv.56）

### 7.2 处理策略（不伪造数据）

```
1. 内置【少量样例数据】（如 Lv.1~30 或用户常驻等级段），来源注明"参考自怀旧冒险岛资料库"，
   且字段带 source + approximate 标记。绝不硬编码伪造的完整表。
2. 提供【导入 JSON 经验表】入口：用户可粘贴/上传标准格式
   [{ "level":1, "requiredExp":15 }, ...]
3. 更重要：默认开启【自举算法】（见 §4）——工具在运行中自动把每级所需经验学出来，
   存入 expTable 表（source:'inferred', approximate:true）。
   一旦某级 requiredExp 被 3 帧交集确认，即可脱离内置表工作。
4. 数据来源与精度在 UI 上如实标注（参考站也有"数据来源""窗口边界和跨级经验可能采用估算"文案）。
```

> 这样即使不打包完整表，工具也能正常工作；表只是冷启动加速。

---

## 8. 风险清单（明确列出可能做不到 / 精度不够的环节）

| # | 风险 | 影响 | 概率 | 降级方案 |
|---|------|------|------|---------|
| R1 | **浏览器后台 >5 分钟 → 采样塌到 1/分钟** | 「近 60 秒速率」失真；/小时靠时间戳仍准 | 高 | Worker 定时器 + 音轨保活 + UI 提示；/小时 用时间戳计算；「近 60 秒」在掉帧时显示"采样不足" |
| R2 | **高光扫过经验条** | 单帧比例从 50%→100% | 高（必然发生） | **必须跨帧 2D 中值**（实测 0.0px 误差）；否则降级为纯文字读数 |
| R3 | **游戏字体非固定 / 用户换字体 / 国际服字体不同** | 模板匹配失效 | 中 | 提供「模板采集」校准向导；兜底 Tesseract；最后手段手动输入 |
| R4 | **技能特效完全遮挡经验条/文字** | 该帧读数无效 | 中 | 拒识该帧；连续 N 帧无效则暂停计时并提示（参考站文案"请保持游戏画面可见"） |
| R5 | **文字读数能读、但像素比例无法读**（条太细/被遮挡） | 无法交叉校验 | 中 | 只用文字 + 自举算法；标 `approximate:true` |
| R6 | **getDisplayMedia 在某些环境不可用**（企业策略、Firefox/Safari 差异） | 无法采集 | 中 | 明确要求 Chrome/Edge 最新版（参考站 SEO 也写"Requires recent Chrome/Edge"）；给出诊断提示 |
| R7 | **等级读数识别失败** → 无法检测升级 | 跨级经验算错 | 中 | 用数值突降 + 突变幅度判定；提示"请打开角色面板" |
| R8 | **经验条 0% 或 100% 的边界** | 比例法退化 | 低 | 特殊检测；结合文字 |
| R9 | **Canvas 抓帧性能**（高分辨率 + 每秒识别） | 主线程卡顿 | 低 | 识别放 Worker（OffscreenCanvas）；限制 ROI 尺寸 |
| R10 | **数据链路：屏幕捕获帧率 ≠ 游戏帧率** | 采样与游戏不一致 | 低 | 只关心"经验随时间变化"，与帧率无关 |

### 必须直说的结论

1. **「浏览器内 OCR 读游戏画面」在本项目里是完全可行的**，但**主识别器不应是通用 OCR（Tesseract）**，而应是**固定字体模板匹配**——这才是正确工具。通用 OCR 在这里既慢又贵又不准。
2. **像素比例法可行，但必须配跨帧 2D 中值**，否则高光会让它间歇性报废。仅凭单帧像素法不可靠。
3. **没有任何"读不到就完了"的死路**：即使文字和比例都读不到，也能靠「时间戳 + 上次确认值 + 自举算法」继续提供 /小时 的近似值（标 approximate）。参考站也是这么设计的。
4. **唯一真正的硬约束是后台节流**（R1），它无法完全消除，只能缓解 + 如实提示。

---

## 9. 给工程师的实现建议（关键算法伪代码）

### 9.1 主循环

```ts
// timer.worker.ts —— 采集驱动（不受后台节流）
let n = 0
setInterval(() => postMessage(n++), 1000)

// useCapture.ts —— 主线程
const buffer: Float64Array[] = []          // 环形缓冲，存每帧的列剖面
const FRAME_N = 12

async function captureOnce() {
  const t = performance.now()
  // 1) 抓帧
  const frame = await grabFrame(video, canvas)          // ROI 裁剪在 grabFrame 内做
  // 2) 经验条像素 -> 列剖面
  const profile = columnProfile(frame, calib.expBar)     // 见 9.2
  buffer.push(profile); if (buffer.length > FRAME_N) buffer.shift()
  // 3) 跨帧 2D 中值 -> 比例
  const ratio = ratioFromProfiles(buffer)                // 见 9.3
  // 4) 文字读数（模板匹配）
  const abs = readDigits(frame, calib.expText)           // 见 9.4
  const level = readDigits(frame, calib.level)
  // 5) 交叉校验
  const r = estimator.observe(level, { absolute: abs, ratio }, t)
  if (r.accepted) accumulate(t, r.requiredExp, abs, ratio)
  ui.update(...)
}
```

### 9.2 列剖面（单帧）

```ts
function columnProfile(frame, box): Float64Array {
  const out = new Float64Array(box.w)
  for (let dx = 0; dx < box.w; dx++) {
    const vals = []
    for (let dy = 0; dy < box.h; dy++) {
      const [r,g,b] = pixel(frame, box.x+dx, box.y+dy)
      vals.push(r - 1.2*b + 0.2*g)              // fillness
    }
    vals.sort((a,b)=>a-b)
    out[dx] = vals[Math.floor(vals.length * 0.3)]  // 30 分位，压掉条上的白字
  }
  return out
}
```

### 9.3 跨帧 2D 中值 → 比例（★ 最关键）

```ts
function ratioFromProfiles(buffer): number {
  const W = buffer[0].length
  const clean = new Float64Array(W)
  for (let dx = 0; dx < W; dx++) {
    const col = buffer.map(p => p[dx]).sort((a,b)=>a-b)
    clean[dx] = col[Math.floor(col.length / 2)]     // 逐列跨帧中值
  }
  // 全满检测（避免 Otsu 退化）
  const mn = Math.min(...clean), mx = Math.max(...clean)
  if (mx - mn < 6) return clean[mx > 阈值? 1 : 0]   // 全满 / 全空
  const thr = otsu(clean, mn, mx)
  let boundary = 0, holes = 0
  const maxHoles = Math.max(2, Math.round(W * 0.01))
  for (let i = 0; i < W; i++) {
    if (clean[i] >= thr) { boundary = i + 1; holes = 0 }
    else if (++holes > maxHoles) break
  }
  return boundary / W
}
```

### 9.4 数字模板匹配

```ts
function readDigits(frame, box): number | null {
  const roi = cropGray(frame, box)
  const bin = binarize(roi)                         // 前景=1
  const segs = splitByProjection(bin)               // 列投影谷值分割
  let str = ''
  for (const s of segs) {
    const g = tightBBox(crop(bin, s))
    const canvas = scaleToFixed(g, 24, 32)          // 归一化画布
    const ranked = templates.map(t =>
      ({ ch: t.ch, score: ncc(canvas, t.canvas) })).sort((a,b)=>b.score-a.score)
    const [best, second] = ranked
    if (best.score < 0.55 || best.score - second.score < 0.03) return null  // 拒识
    str += best.ch
  }
  return parseNumber(str)                           // 处理千分位/百分号
}
```

### 9.5 自举经验表（移植枫记）

```ts
// 完整实现见 probe\_estimator_pretty.js，核心：
function rangeFromReading({absolute, ratio}, precision = 2) {
  if (absolute <= 0 || ratio <= 0) return undefined
  const tol = 0.5 * 10 ** -precision / 100
  const rMin = Math.max(Number.MIN_VALUE, ratio - tol)
  const rMax = Math.min(1, ratio + tol)
  const minimum = Math.max(absolute, Math.ceil(absolute / rMax))
  const maximum = Math.floor(absolute / rMin)
  return (minimum > 0 && maximum >= minimum) ? { minimum, maximum } : undefined
}
// 多帧取交集 -> 收敛 -> confirmed = pick(intersection)
```

### 9.6 图表库建议

对齐参考站用 **uPlot 1.6.x**（~50KB min+gz），而非 ECharts（~300KB+）。实时高频更新场景 uPlot 更合适。

---

## 10. 依赖包清单汇总

| 包 | 版本建议 | 用途 | 体积 | 阶段 |
|----|---------|------|------|------|
| `vue` | ^3.5 | 框架 | — | P0 |
| `element-plus` | ^2.14 | UI 组件 | — | P0 |
| `pinia` | ^4 | 状态 | ~10KB | P0 |
| `dexie` | ^4.4 | IndexedDB | ~30KB | P0 |
| `uplot` | ^1.6 | 折线图 | ~50KB | P0 |
| （无） | — | 模板匹配（手写） | 0 | P0 |
| `tesseract.js` | ^7 | 兜底 OCR | ~7-15MB 首载 | P2（动态 import） |
| `pngjs` | ^7 | 仅 Node 侧测试 | 0.62MB | dev |
| `puppeteer-core` | latest | 仅预研/测试 | — | dev |

---

## 11. 实验产物索引

| 文件 | 内容 |
|------|------|
| `probe\exp1c_expbar.js` / `out\exp1c.out.txt` | 经验条比例识别（干净/噪声/高光/多帧） |
| `probe\exp2d_digits.js` / `out\exp2d.out.txt` | 数字模板匹配（分割/归一化/混淆/缩放/平移/噪声） |
| `probe\exp3_validate.js` / `out\exp3.out.txt` | 交叉校验 + 自举经验表算法验证 |
| `probe\exp4_timer.js` / `out\exp4.out.txt` | 前台定时器基准 |
| `probe\exp4b_timer_bg.js` / `out\exp4_bg.out.txt` | **后台节流实测** |
| `probe\exp5b_highlight.js` / `out\exp5b.out.txt` | 高光/白字干扰 |
| `probe\exp5c_temporal.js` / `out\exp5c.out.txt` | **2D 跨帧中值（高光解法）** |
| `probe\_estimator_pretty.js` | 反混淆的枫记自举经验表算法（完整） |
| `probe\out\exp2_results.json` | 模板匹配原始数据 |
| `probe\*.png` | 生成的测试位图 |

---

## 附：一句话总结

> **这个项目技术上完全可行，最大的两个坑是「浏览器后台节流」和「经验条高光」，两个坑都已有经实验验证的解法（Worker 定时器 + 跨帧 2D 中值）。文字识别必须放弃通用 OCR、改用固定字体模板匹配，这是唯一在「每秒 1 次」频率下站得住脚的方案。经验表可以不预算，靠枫记同款自举算法边跑边学。**
