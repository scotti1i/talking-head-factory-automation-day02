# 口播视频工程化流程

## 0. 定义目标

每条视频开工前先写清：

- 标题候选
- 平台：默认抖音竖屏
- 目标时长
- 观众是谁
- 主论点是什么
- 哪些段落需要章节 / 解释层

## 1. 原片清点与一次转录

原片放进 `assets/originals/`，先跑：

```bash
npm run inventory -- --job jobs/<slug>
npm run transcribe:editor -- --job jobs/<slug>
```

转录按素材哈希缓存，编辑与字幕共用；不要对粗剪再次 Whisper。

## 2. 语义 A-roll 粗剪

读 `project.md` 和 `data/takes-packed.md`，把语义完整的保留段写进 `data/rough-cut-edl.json`。不要让静音检测替代判断。

必须处理：

- 看词停顿
- 长静音
- 表达失败后重录的 overlap
- 重复句
- 明显卡顿

渲染并逐切点检查：

```bash
npm run roughcut:render -- --job jobs/<slug>
npm run qa:cuts -- --job jobs/<slug>
```

每张电影条和波形都看完并修正 EDL 后，才写 `qa/cuts/approval.json`。

## 3. 从缓存生成字幕

```bash
npm run captions:build -- --job jobs/<slug>
```

生成后通篇校准人名、产品名、英文术语与断句。

目标格式：

```json
[
  { "s": 0.0, "e": 2.4, "t": "第一句字幕" },
  { "s": 2.4, "e": 5.0, "t": "第二句字幕" }
]
```

## 4. 排 beats 与 B-roll

章节不是越早越好。开头钩子没讲完，不要先把完整目录弹出来。

目标格式：

```json
[
  { "start": 46, "duration": 4.5, "num": "02", "title": "问答 AI 的上限" }
]
```

解释信息统一写入 `data/beats.json`。B-roll 写入 `data/broll.json`，每段必须有 `intent` 与 `reason`。

## 5. 写解释层

解释层只在三种情况下出现：

- 口播信息量太高
- 有流程 / 对比 / 数字需要视觉化
- 观众不看图会跟丢

目标格式：

```json
[
  {
    "id": "workflow",
    "start": 100,
    "duration": 8,
    "kicker": "工作流",
    "title": "Agent 不是问答",
    "body": "它会读取资料、调用工具、执行任务。",
    "bullets": ["读取上下文", "执行动作", "复盘迭代"],
    "hideCaptions": true
  }
]
```

新工作流不使用 `overlays.json`；上例只用于旧 job 兼容。字幕默认完整保留，并按卡片位置让位。

## 6. 构建 composition

```bash
npm run build -- --job jobs/<slug>
```

这一步会生成：

```text
jobs/<slug>/index.html
jobs/<slug>/renders/
jobs/<slug>/qa/
```

所有字幕、章节、解释层都会变成静态 `data-start` / `data-duration` clip。

如果要一次产出横屏 / 竖屏多版本：

```bash
npm run build:variants -- --job jobs/<slug>
npm run check:variants -- --job jobs/<slug>
npm run render:variants -- --job jobs/<slug>
```

多版本说明见 [multi-format.md](multi-format.md)。

## 7. 检查

```bash
npm run check:variants -- --job jobs/<slug>
```

必须通过：

- HyperFrames lint
- HyperFrames validate
- HyperFrames inspect

## 8. 渲染

Review 版：

```bash
npm run render:review
```

最终版：

```bash
npm run render:final
```

默认最终参数：

- 1080x1920
- 60fps
- standard quality
- 24M video bitrate

经验：`high` 质量可能在长视频最终编码阶段被系统杀掉；`standard + 24M + 60fps` 是更稳的抖音交付参数。

## 9. 最终 QA

回项目根目录：

```bash
npm run qa -- --job jobs/<slug> --video jobs/<slug>/renders/final-60fps.mp4
```

输出：

```text
jobs/<slug>/qa/final-frames/
jobs/<slug>/qa/report.json
jobs/<slug>/qa/report.md
```

必须看最终 MP4 抽出来的帧，不看预览。

## 10. 交付

```bash
npm run deliver -- --job jobs/<slug> --video jobs/<slug>/renders/final-60fps.mp4
```

`deliver` 会复制到 `Downloads`。它不会删除目标文件夹里的用户文件。

## 11. Vault 记录

记录至少包含：

- 标题
- 成片路径
- 封面路径
- 口播稿路径
- 分辨率 / 帧率 / 时长 / 码率
- QA 抽帧路径
- 发布状态
- 后续数据回填表
