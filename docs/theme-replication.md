# 主题模板与截图复刻流程

风格不许逐条视频发明。每种视觉 = `themes/<id>/` 下的一个主题包,选主题是控制台"包装"工位的一个开关。

## 主题包结构

```text
themes/
├── registry.json          # 注册表:default + themes 列表 + 铁律
├── _shared/
│   ├── fonts/             # 冻结字体(构建时硬链接进 job)
│   └── vendor/gsap.min.js # 冻结动效引擎
└── <id>/
    ├── theme.json         # label / description / fonts / tokens(约 30 个设计令牌)
    ├── overrides.css      # 可选:结构级改造(追加在基础 CSS 之后)
    └── preview.jpg        # 真渲染预览(控制台主题卡展示用)
```

`build:beats` 只认 tokens + overrides.css;拍子数据(beats.json)与主题完全解耦——同一条视频换主题只需重新构建,不改数据。

## 截图复刻流程(新增主题的唯一正道)

对标高端科普 / 纪录片风博主的包装,验证过最有效的方法是**截图 → 复刻**:

1. **采样**:找对标博主 2-3 条代表作,截 5-8 张"信息卡出现瞬间"的帧(数据对比卡、要点卡、金句卡、流程卡各截一张)。存到 `themes/<新id>/reference/`。
2. **拆解**:对着截图回答四件事——
   - 色板:底色 / 主文字 / 强调色 / 卡片底(渐变?玻璃?纯色?)
   - 字排:标题字重字号、正文字体(衬线感?手写感?)、kicker 处理
   - 卡片解剖:圆角、描边、顶线、投影、模糊
   - 布局气质:卡片贴哪个安全区、留白密度
3. **落 tokens**:复制 `themes/warm-glass/theme.json` 为 `themes/<新id>/theme.json`,把拆解结果逐个填进 tokens。改不动的结构(如浅色纸质主题需要深色字幕描边)写进 `overrides.css`。
4. **注册**:把 id 加进 `themes/registry.json` 的 `themes` 数组。
5. **对照验证**:用合成回归 job 构建 + 抽帧,和参考截图并排比对:
   ```bash
   node scripts/create-regression-job.mjs
   node scripts/build-beats-composition.mjs --job jobs/regression --theme <新id>
   cd jobs/regression && npx --yes hyperframes@0.5.6 snapshot . --at 6.0
   ```
6. **出预览**:满意后把抽帧转成预览图,并把回归 job 恢复默认主题:
   ```bash
   ffmpeg -y -i jobs/regression/snapshots/frame-00-at-6s.png -vf scale=540:-2 -q:v 4 themes/<新id>/preview.jpg
   node scripts/build-beats-composition.mjs --job jobs/regression
   ```
7. **冻结**:主题一旦用于成片就冻结;要演进就改 tokens 并在 description 记版本,全量统一,不逐条漂。

> 复刻的是**版式语言**(色板/字排/卡片解剖),不是照抄内容或 logo。tokens 化之后天然就是"神似而非形抄"。

## 现有主题

| id | 来源 | 定位 |
|----|------|------|
| `warm-glass` | 验收成片抽取 | 默认。深棕暖玻璃,不挡脸、全字幕 |
| `pastel-ledger` | 纸感科普风复刻 | 奶白纸卡+打字机字距+糖果数据色+贴纸 kicker |
| `field-notes` | 档案纪录片风复刻 | 米黄档案纸+重衬线+砖红马克笔+胶带贴片 |
| `signal-yellow` | 高对比海报风复刻(品牌黄 #FFEB00) | 黑幕荧光黄,扁平硬边零投影,海报冲击 |
| `steel-blueprint` | 工程制图风复刻 | 冷灰蓝工程制图,hairline+等宽标注,橙红唯一彩色 |
| `neon-forest` | build-composition.mjs 原生色板 | 墨绿霓虹,延续早期系列视觉 |

> 注:新主题的 overrides.css 用到 macOS 系统字体(Courier New / Songti SC / SF Mono),渲染在本机 headless Chrome 完成,本机确定性成立;若迁移渲染环境需把字体冻结进 `_shared/fonts/`。

## 回归基准

`jobs/regression` 是脚本合成的常驻基准 job(`node scripts/create-regression-job.mjs` 随时重建,6 种组件 + 10 条字幕 + 2 段 B-roll,零真实素材):
- 改 builder / 主题后必须跑 `npm run regression`(构建竖横屏并通过静态检查);
- 它也是所有主题预览图的取景棚(6.0s 的 split 卡)。
