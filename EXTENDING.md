# 二次开发指南

这份文档给想改造这套口播成片流水线的人。先记住一条分工：**skill 做判断，脚本做执行，`docs/data-contract.md` 是接口**。你的改造大多落在其中一层，别把三层搅在一起。

- 判断层（语义剪辑、字幕校准、beats / B-roll 取舍）→ `skills/talkinghead-edit/SKILL.md`
- 执行层（确定性的转码、渲染、QA、交付）→ `scripts/*.mjs`
- 接口（唯一事实源）→ `docs/data-contract.md`

---

## 一、架构地图（管线阶段 → 命令 → 输入/输出）

一条口播从原片到交付，走这条固定管线。命令都在仓库根目录跑（`package.json` 里可查全）：

| 阶段 | 命令 | 读 | 写 |
|---|---|---|---|
| 1. 建 job | `npm run new -- <slug>` | — | `jobs/<slug>/`（`project.md` / `project.json` 骨架） |
| 2. 清点原片 | `npm run inventory -- --job jobs/<slug>` | `assets/originals/` | `data/source-inventory.json` |
| 3. 词级转录（哈希缓存） | `npm run transcribe:editor -- --job jobs/<slug>` | 原片 | `data/transcripts/index.json` + `data/takes-packed.md` |
| 4. 查状态 | `npm run status -- --job jobs/<slug>` | job 全量 | 终端报告 |
| 5. 语义粗剪 | 写 `data/rough-cut-edl.json` → `npm run roughcut:render -- --job jobs/<slug>` | EDL + 原片 | 干净 A-roll |
| 6. 切点 QA | `npm run qa:cuts` → 逐张看 → `npm run qa:cuts:approve` | 粗剪 | `qa/cuts/cut-*.jpg` + `qa/cuts/approval.json` |
| 7. 字幕 | `npm run captions:build -- --job jobs/<slug>` | 转录缓存 + EDL | `data/captions.json` |
| 8. 排 beats / B-roll | 写 `data/beats.json`、`data/broll.json` | 人 / 模型判断 | 同名数据文件 |
| 9. 构建 composition | `npm run build:beats -- --job jobs/<slug>` | 上述全部数据 | `jobs/<slug>/index.html` |
| 10. 多版本 | `npm run build:variants` → `npm run check:variants` | 同一份数据 | `variants/<id>/index.html` |
| 11. 渲染 | `npm run render:variants`（或 `render:review` / `render:final`） | composition | `renders/*.mp4` |
| 12. 最终 QA | `npm run qa` → `npm run qa:final:approve` | 最终 MP4 | `qa/final-frames/` + `qa/approval.json` |
| 13. Shorts（可选） | `npm run cut:shorts -- --job jobs/<slug>` | 竖屏母版 + `data/shorts.json` | Shorts MP4 |
| 14. 交付 | `npm run deliver:variants -- --job jobs/<slug>` | 成片 | 交付目录（默认 Downloads），不删用户文件 |

关键性质：转录按**素材哈希**缓存，编辑和字幕共用同一份，不重复跑模型；竖屏和横屏由**同一个 builder、同一份数据**构建，不互相二压。

---

## 二、三个常见改造

### ① 加一个信息组件

一个"信息卡"（statement / split / list…）是 `components/<id>/` 下的固定四件套：

```text
components/<id>/
├── component.json   # manifest：id、formats、requiredFields、apply 等
├── fixtures.json    # 预览样例（正常 / 长文案 / 数字 / 中英混排）
├── render.mjs       # 导出 render(beat) → 返回 HTML，文案先 escapeHtml
└── style.css        # 主题值用 {{tokenName}}，选择器收口在 .beat-<id>
```

目录扫描器**自动发现**新组件，不用改 App 名单、builder 白名单或任务卡。字段合同、最短验证命令见 [`docs/component-authoring.md`](docs/component-authoring.md)。

### ② 加一套主题

主题定义色板 / 字体 / 卡片解剖，和 beats 数据完全解耦——换主题只需重新构建，不改数据。一套主题 = `themes/<id>/`：

```text
themes/<id>/
├── theme.json      # label / description / fonts / 约 30 个设计 token
├── overrides.css   # 可选：结构级改造（追加在基础 CSS 之后）
└── preview.jpg     # 真渲染预览
```

加完把 id 注册进 `themes/registry.json` 的 `themes` 数组。**新风格 = 新主题，不逐条视频手搓配色**；标准做法是"截图 → 复刻版式语言"，完整流程见 [`docs/theme-replication.md`](docs/theme-replication.md)。

### ③ 换转录引擎

默认引擎是本地 `whisper-cli`，边界收在 `scripts/transcribe-editor.mjs`：

- 模型解析优先级（`scripts/lib.mjs` 的 `whisperModelPath`）：`--model` 参数 > `WHISPER_MODEL` 环境变量 > 默认 `~/.cache/whisper-cpp/ggml-large-v3-turbo.bin`。想换模型不改代码，设 `WHISPER_MODEL` 即可。
- 引擎调用点：`transcribe-editor.mjs` 里 `run("whisper-cli", [...])` 那一行，输出原始 JSON 后 normalize 成词级结构。
- **词级 JSON 合同**：不管用哪个引擎，产物必须是按素材哈希缓存的词级 JSON——`data/transcripts/<stem>-<hash>.json` 里带 `words: [{ 词, 起, 止 }, …]`，并汇进 `data/transcripts/index.json`。只要产物守住这个形状，下游的粗剪、字幕全都不用改。

换引擎（比如换成云端 ASR 或另一个本地模型）= 替换那一处 shell-out + normalize，让输出仍然满足词级 JSON 合同。别在下游改，改在这一层。

---

## 三、边界红线（改造时不许越）

1. **生成物不是编辑输入。** `index.html`、MP4、截图都是渲染产物；唯一事实源是 `docs/data-contract.md` 列的那些数据文件。别把生成的 HTML 当输入回喂，也别手改生成的 HTML。
2. **原片永远保留。** 未剪原片放 `assets/originals/`，只读。任何流程不覆盖、不删原片。
3. **不用静音检测替代语义剪辑。** EDL 必须按语义完整性写，每个保留段有理由；`create-rough-cut-edl.mjs`（静音检测）是历史兼容脚本，不进主链。
4. **不覆盖用户交付文件。** 交付脚本默认不删目标目录里用户手放的文件（封面等）。
5. **主题只从 registry 选，画幅走同一 builder。** 不逐 job 手搓配色，不把竖屏硬裁成横屏。

---

## 术语表

| 词 | 含义 |
|---|---|
| **A-roll** | 说话人主画面（口播本体）。 |
| **B-roll** | 覆盖在 A-roll 上的辅助画面（录屏、素材），默认保留说话人小窗（PIP）。 |
| **EDL** | Edit Decision List，`data/rough-cut-edl.json`，用原片绝对时间标"保留哪几段"。 |
| **beat** | 一张解释性信息卡（`data/beats.json` 里一项），由某个 component 渲染。 |
| **component** | 信息卡的可复用类型（`components/<id>/`），决定一类 beat 长什么样。 |
| **theme** | 一套视觉家族（`themes/<id>/`），定义色板 / 字体 / 卡片解剖，与 beats 数据解耦。 |
| **variant** | 同一份数据派生的一个画幅版本（竖屏 / 横屏 / Shorts）。 |
| **take / job** | take = 一条原始录制；job = 一条口播的工程目录 `jobs/<slug>/`。 |
| **PIP** | Picture-in-Picture，B-roll 段里保留的说话人小窗。 |
| **GOP** | 关键帧间隔；粗剪固定 1 秒 GOP，避免并行 seek 时黑帧。 |
