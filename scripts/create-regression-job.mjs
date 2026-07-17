// 自足回归基线：全部素材由 ffmpeg 现场合成，不携带任何真实视频。
// 覆盖面按 README 回归要求：竖屏 + 横屏、完整字幕、多种 beats 组件、B-roll（含 PIP）。
// 用法：node scripts/create-regression-job.mjs
//   && npm run build:variants -- --job jobs/regression
//   && npm run check:variants -- --job jobs/regression
import fs from "node:fs";
import path from "node:path";
import { copyDir, projectRoot, run, writeJson } from "./lib.mjs";

const root = projectRoot();
const jobDir = path.join(root, "jobs", "regression");
const templateDir = path.join(root, "templates", "job");

fs.rmSync(jobDir, { recursive: true, force: true });
copyDir(templateDir, jobDir);

const DURATION = 24;

// A-roll：渐变底 + 正弦音，1s GOP（与生产粗剪一致，防并行 seek 黑帧）。
const arollPath = path.join(jobDir, "assets", "aroll.mp4");
run("ffmpeg", [
  "-y",
  "-f", "lavfi",
  "-i", `gradients=s=1080x1920:d=${DURATION}:r=30:c0=#20302b:c1=#0f1a16`,
  "-f", "lavfi",
  "-i", `sine=frequency=330:duration=${DURATION}`,
  "-shortest",
  "-c:v", "libx264",
  "-g", "30", "-keyint_min", "30", "-sc_threshold", "0",
  "-pix_fmt", "yuv420p",
  "-c:a", "aac",
  arollPath
]);

// B-roll 素材：另一配色 + 走动方块，肉眼可与 A-roll 区分。
const brollDir = path.join(jobDir, "assets", "broll");
fs.mkdirSync(brollDir, { recursive: true });
const brollPath = path.join(brollDir, "screen.mp4");
run("ffmpeg", [
  "-y",
  "-f", "lavfi",
  "-i", "testsrc2=s=1280x720:d=8:r=30",
  "-c:v", "libx264",
  "-g", "30", "-keyint_min", "30", "-sc_threshold", "0",
  "-pix_fmt", "yuv420p",
  "-an",
  brollPath
]);

writeJson(path.join(jobDir, "project.json"), {
  title: "Regression Baseline",
  slug: "regression",
  platform: "douyin",
  width: 1080,
  height: 1920,
  layout: "vertical",
  duration: DURATION,
  sourceVideo: "assets/aroll.mp4",
  outputName: "regression-final.mp4",
  downloadFolderName: "regression-baseline",
  caption: { enabled: true, maxCharsPerLine: 14, hideDuring: [] },
  qa: { sampleTimes: [0.5, 5.5, 11.2, 16.8, 21.5, 23.4] },
  delivery: {
    includeCover: false,
    downloadsRoot: path.join(root, "out")
  },
  variants: [
    {
      id: "douyin-vertical",
      label: "竖屏回归",
      platform: "douyin",
      width: 1080,
      height: 1920,
      layout: "vertical",
      outputName: "regression-vertical.mp4",
      downloadFolderName: "regression-vertical",
      render: { fps: 60, quality: "standard", workers: 8, videoBitrate: "24M" }
    },
    {
      id: "youtube-horizontal",
      label: "横屏回归",
      platform: "youtube",
      width: 1920,
      height: 1080,
      layout: "horizontal",
      outputName: "regression-horizontal.mp4",
      downloadFolderName: "regression-horizontal",
      caption: { maxCharsPerLine: 22 },
      render: { fps: 60, quality: "standard", workers: 8, videoBitrate: "24M" }
    }
  ]
});

// 字幕铺满时间轴：验证换行、与 beats/浮层的层级关系。
writeJson(path.join(jobDir, "data", "captions.json"), [
  { s: 0.3, e: 2.2, t: "这是回归基线的第一句字幕" },
  { s: 2.2, e: 4.4, t: "所有素材都是现场合成的" },
  { s: 4.4, e: 6.8, t: "字幕要和信息卡同屏不打架" },
  { s: 6.8, e: 9.2, t: "接下来验证对比型组件" },
  { s: 9.2, e: 11.6, t: "然后是列表和流程组件" },
  { s: 11.6, e: 14.0, t: "B-roll 期间保留人像小窗" },
  { s: 14.0, e: 16.4, t: "浮层出现时字幕要让位" },
  { s: 16.4, e: 18.8, t: "横屏与竖屏共用这份数据" },
  { s: 18.8, e: 21.2, t: "同一个 builder 派生两个画幅" },
  { s: 21.2, e: 23.6, t: "回归通过才允许改 builder" }
]);

// 六种组件各出一拍：statement / split / chips / duel / trio / pipeline。
writeJson(path.join(jobDir, "data", "beats.json"), [
  {
    type: "statement",
    start: 1.0,
    end: 4.0,
    kicker: "回归基线",
    title: "一份数据两个画幅",
    body: "这张卡验证陈述组件的字号与留白。",
    accent: "全部合成"
  },
  {
    type: "split",
    start: 4.5,
    end: 8.0,
    kicker: "对比",
    title: "手工与工厂",
    left: { label: "以前", title: "手工重来", lines: ["风格漂移", "重复转录"] },
    right: { label: "现在", title: "工厂复用", lines: ["合同统一", "逐关 QA"] }
  },
  {
    type: "chips",
    start: 8.5,
    end: 11.0,
    kicker: "工具链",
    title: "各自只做一件事",
    chips: ["转录", "剪辑", "字幕", "渲染"],
    body: "工具之间由数据合同连接。"
  },
  {
    type: "duel",
    start: 11.5,
    end: 14.0,
    kicker: "取舍",
    title: "别把工具当系统",
    bad: "每条重新发明",
    good: "稳定组件复用",
    body: "取舍要具体到可执行。"
  },
  {
    type: "trio",
    start: 14.5,
    end: 17.5,
    kicker: "三根支柱",
    title: "稳定工厂靠什么",
    columns: ["工具", "流程", "判断"],
    body: "少一项都只是一次性结果。"
  },
  {
    type: "pipeline",
    start: 18.0,
    end: 21.0,
    kicker: "流程",
    title: "母版派生交付",
    steps: ["原片", "精剪", "包装", "QA"],
    body: "每步都有明确输入输出。"
  }
]);

// B-roll：两段、避开前 3 秒、单段 ≤10s、总计 5.5s（≤25%）、保留 PIP。
writeJson(path.join(jobDir, "data", "broll.json"), [
  {
    id: "regression-fullscreen-pip",
    start: 11.5,
    end: 15.5,
    src: "assets/broll/screen.mp4",
    mode: "fullscreen-pip",
    pipShape: "circle",
    intent: "验证全屏 B-roll 与人像小窗层级",
    reason: "回归必须覆盖 B-roll 分支",
    label: "B-roll 回归 A"
  },
  {
    id: "regression-short-insert",
    start: 19.0,
    end: 20.5,
    src: "assets/broll/screen.mp4",
    mode: "fullscreen-pip",
    pipShape: "rounded",
    intent: "验证第二段 B-roll 与前段互不重叠",
    reason: "覆盖 rounded 小窗形状",
    label: "B-roll 回归 B"
  }
]);

writeJson(path.join(jobDir, "data", "chapters.json"), [
  { start: 1.0, duration: 1.2, num: "01", title: "组件回归" },
  { start: 18.0, duration: 1.2, num: "02", title: "画幅回归" }
]);

writeJson(path.join(jobDir, "data", "overlays.json"), [
  {
    id: "overlay-regression",
    start: 15.8,
    duration: 1.8,
    kicker: "浮层",
    title: "解释层回归",
    body: "浮层出现时隐藏重叠字幕。",
    bullets: ["静态时间轴", "抽帧核对"],
    hideCaptions: true
  }
]);

console.log(`Created regression job: ${jobDir}`);
console.log("Next: npm run build:variants -- --job jobs/regression && npm run check:variants -- --job jobs/regression");
