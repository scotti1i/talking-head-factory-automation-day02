# Skills

本目录放的是**模型判断层**：`talkinghead-edit` skill。它负责语义剪辑、字幕校准、beats / B-roll 取舍这类需要判断力的工序；确定性执行交给仓库里的 `scripts/`，两层的接口是 [`docs/data-contract.md`](../docs/data-contract.md)。

Claude Code 和 Codex 都能当这个 skill 的智能入口。

## 安装

在仓库根目录跑：

```bash
node scripts/install-skills.mjs
```

它会把 `skills/talkinghead-edit` 安装到你机器上已存在的家：

- Claude Code → `~/.claude/skills/talkinghead-edit`
- Codex → `~/.codex/skills/talkinghead-edit`

行为约定：

- 只给检测到的 CLI 装（`~/.claude` / `~/.codex` 存在才算装了）；两个都没有会提示先装其一。
- 已存在同名 skill → **跳过，绝不覆盖**你现有的安装。
- posix 用软链（改仓库即时生效），Windows 用递归拷贝。
- 卸载：`node scripts/install-skills.mjs --uninstall`（只移除本脚本自己装的那份）。

装完把仓库路径设进环境变量，skill 每次都能定位到它：

```bash
export TALKINGHEAD_FACTORY="/path/to/talking-head-video-factory"
```

## 唤醒话术（两家同一句）

> 用 talkinghead-edit 把这个口播原片做成竖屏和横屏成片

## Claude Code 与 Codex 的差异

| | Claude Code | Codex |
|---|---|---|
| skill 目录 | `~/.claude/skills/` | `~/.codex/skills/` |
| 入口文件 | `SKILL.md`（YAML frontmatter + 正文） | 同一份 `SKILL.md` |
| 额外清单 | 无 | `agents/openai.yaml`（Codex 读它拿 display name 和默认 prompt） |
| 唤醒方式 | 自然语言点名 skill | 自然语言点名 skill |

两家读的是同一份 `SKILL.md`，工作流一致；差异只在安装目录，和 Codex 多读一个 `agents/openai.yaml` 清单。skill 内容对两家保持一致，不要给某一家写分叉逻辑。
