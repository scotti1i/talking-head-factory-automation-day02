# 视觉资产目录合同

`families/*.json` 只登记随开源包分发、用户 clone 下来真实存在的视觉家族：现役主题 × 组件。历史成片包装档案（原先绑定作者真实视频的 evidence 抽帧）已随脱敏一并移除，不再以“无源可看”的条目留在目录里。

运行时目录由 `console/visual-library.mjs` 聚合三类事实源：

1. `visual-assets/families/*.json`：当前生产视觉家族与 lineage。
2. `components/*/component.json`、`themes/*/theme.json`：自动发现的组件和主题。
3. `out/visual-library/manifest.json`、`jobs/*/data/beats.json`：真实预览状态与使用记录。

统一 kind 只有五种：`theme`、`component`、`layout`、`preset`、`legacy-composition`。生命周期、兼容性和预览状态分别使用：

- `lifecycle`: `draft | published | archived`
- `compatibility`: `supported | preview-only | unsupported`
- `preview.state`: `ready | missing | stale | rendering | failed | unsupported`

目录 loader 不会因为 JSON 损坏、来源缺失或预览失败而过滤资产。错误会进入该资产的 `health.issues` 和顶层 `errors`。

新增组件不应修改 App 名单：只新增 `components/<id>/` 组件包，目录会在下一次请求时自动发现。

组件四件套合同与验证命令见 [`docs/component-authoring.md`](../docs/component-authoring.md)；beats 的双画幅语义见 [`docs/data-contract.md`](../docs/data-contract.md#beatsjson-的画幅合同)。第 11 个组件与后续组件都走同一自动发现路径。

当前开源验收基线是 1 套生产视觉家族（`beats-v2-face-safe`）、10 个生产组件和 7 套主题。家族与主题的代表预览是本仓自带 `scripts/visual-preview-generate.mjs` 用合成文案（`components/*/fixtures.json`）在合成背景上渲染的设计卡片，`themes/<id>/preview.jpg` 即控制台主题卡展示图，全部不含任何真人画面。

## 真实预览缓存

运行：

```bash
npm run visual:previews -- \
  --component statement --fixture default,long \
  --theme warm-glass --format portrait,landscape
```

默认矩阵是“组件 × 该组件全部 fixture × 主题 × 画幅”。manifest cell key 为 `component/fixture/theme/format`；旧 `component/theme/format` key 只会迁移给该组件的默认 fixture，并因新输入 hash 自然变为 stale。

当前 10 个组件各有 2 个 fixture，因此全量矩阵为 `10 × 2 × 7 × 2 = 280` 个真实 HTML / poster 组合；竖屏与 YouTube 横屏各 140 个。

每个 cell hash 覆盖组件 manifest/renderer/style、该 fixture 的实际 beat、theme JSON 与 overrides、builder、preview generator/lib、共享字体、复制到 job 的 `vendor/gsap.min.js` 来源、真实 A-roll proxy，以及一次性探测的 Node、HyperFrames、Puppeteer、Chrome、pyftsubset 与 Pillow 版本。运行依赖明细写入顶层 manifest 和每个 `result.json`；探测在一次命令中只执行一次，不按 cell 重复。
