# 唯一数据合同

`talkinghead-edit` 只认以下事实源。生成的 HTML、MP4、截图都不是编辑输入。

| 文件 | 责任 | 谁判断 |
|---|---|---|
| `project.md` | 目标、保留项、删除项、包装边界 | 人 / Agent |
| `project.json` | 画布、主题、交付和 variants | 确定性配置 |
| `data/source-inventory.json` | 原片规格与路径 | 脚本 |
| `data/transcripts/index.json` | 素材哈希到词级转录缓存 | 脚本 |
| `data/takes-packed.md` | 供语义剪辑阅读的紧凑转录 | 脚本 |
| `data/rough-cut-edl.json` | 保留段，使用原片绝对语义时间 | 人 / Agent |
| `qa/cuts/approval.json` | 所有切点已逐张检查 | 人 / Agent |
| `data/captions.json` | 校准后的最终字幕 | 人 / Agent |
| `data/beats.json` | 解释性卡片 | 人 / Agent |
| `data/broll.json` | B-roll 时间、素材、意图与理由 | 人 / Agent |
| `data/shorts.json` | Shorts 语义区间 | 人 / Agent |
| `qa/approval.json` | 最终 MP4 抽帧与完整播放状态 | 人 / Agent |

## rough-cut-edl.json

```json
[
  {
    "source": "assets/originals/take-01.mp4",
    "sourceStart": 12.34,
    "sourceEnd": 28.91,
    "reason": "保留完整问题和第一次清晰回答"
  }
]
```

相邻段允许来自不同 take。不得用“删掉 1.2 秒静音”代替语义判断。每个段必须能解释为什么保留。

## broll.json

```json
[
  {
    "id": "workflow-screen",
    "start": 21.2,
    "end": 27.4,
    "src": "assets/broll/workflow.mp4",
    "mode": "fullscreen-pip",
    "pipShape": "circle",
    "intent": "让观众看见口播所说的真实操作界面",
    "reason": "仅靠口头描述难以确认工作流长什么样"
  }
]
```

硬约束：前 3 秒默认不用；单段不超过 10 秒；不重叠；总时长不超过成片 25%；默认保留说话人小窗。`pipShape` 可选 `rounded` / `circle`，默认 `rounded`；竖屏需要圆形人像时显式写 `circle`。

## beats.json 的画幅合同

每个 beat 可用 `formats` 明确它进入哪些成片：

```json
[
  {
    "type": "statement",
    "start": 8.2,
    "end": 12.2,
    "formats": ["portrait"],
    "kicker": "核心判断",
    "title": "竖屏才出现的卡片",
    "body": "横屏会使用另一套重排内容。",
    "accent": "不是硬裁"
  }
]
```

- `portrait`：竖屏语义，标准画布 1080×1920。
- `landscape`：YouTube 横屏语义，标准画布 1920×1080。
- 省略 `formats`：向后兼容，等同于 `["portrait", "landscape"]`，同一拍同时进入竖屏与横屏。
- 显式填写时必须是非空、无重复的数组；只允许 `portrait` / `landscape`。`vertical` / `horizontal` 是 project/layout 与目录别名，不写进 `beats[].formats`。
- builder 先校验 beat 的画幅声明没有越过 `component.json.formats`，再只保留当前目标画幅；beat 不能声明组件本身不支持的画幅。

横屏不是竖屏硬裁：允许同一语义分别写 portrait-only 与 landscape-only beat，两者仍由同一个 `build:beats` builder 和同一份数据合同构建。

## 通过条件

1. 转录命中素材哈希缓存，不重复跑模型。
2. 粗剪后存在逐切点电影条和波形，且 `approval.json` 已写入。
3. 竖屏与横屏由同一个 beats builder 构建并通过 HyperFrames 检查。
4. A-roll 最大关键帧间隔不超过 2 秒；标准粗剪输出固定 1 秒 GOP，避免并行 seek 黑帧。
5. 最终 MP4 规格 QA 与抽帧 QA 都完成。
6. `qa/approval.json` 明确记录是否真的完整播放；未完整播放不得标 publish-ready。
7. Shorts 默认 stream copy；不合规时必须显式允许重编码。
