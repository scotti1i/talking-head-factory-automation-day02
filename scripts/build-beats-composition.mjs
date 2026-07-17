// ============================================================
// 通用 beats 竖横屏合成器
// 数据驱动版的 balanced-face-safe 验收风格:
//   data/beats.json(拍子) + data/captions.json(字幕) + themes/<id>(主题)
//   → index.html(HyperFrames composition,底部安全区包装,不挡脸,全字幕)
// ============================================================
import fs from "node:fs";
import path from "node:path";
import {
  commandOk,
  escapeHtml,
  fmtTime,
  parseArgs,
  projectRoot,
  readJson,
  readJsonArray,
  resolveJob,
  run,
  videoDuration
} from "./lib.mjs";
import {
  COMPONENT_FORMATS,
  catalogById,
  loadComponentCatalog,
  renderComponentStyles
} from "./component-registry.mjs";

const args = parseArgs();
const root = projectRoot();
const jobDir = resolveJob(args.job);
const configPath = path.join(jobDir, "project.json");
if (!fs.existsSync(configPath)) {
  console.error(`缺少 project.json: ${configPath}`);
  process.exit(1);
}
const config = readJson(configPath);
const theme = loadTheme(args.theme || config.theme);
// 中文字体子集是否成功产出；决定 @font-face / preload / 字体栈是否引用 FactoryCJK。
let cjkFontStaged = false;
const width = Number(config.width || 1080);
const height = Number(config.height || 1920);
const format = resolveFormat(config, width, height);
const sourcePreserve = String(config.layout || "").toLowerCase() === "source-preserve";
const sourceVideo = config.sourceVideo || "assets/aroll.mp4";
const sourcePath = path.join(jobDir, sourceVideo);
if (!fs.existsSync(sourcePath)) {
  console.error(`缺少母版 A-roll: ${sourcePath}`);
  console.error("先跑粗剪渲染(npm run roughcut:render)或把成品 A-roll 放到该路径。");
  process.exit(1);
}
const duration = Number(config.duration) > 0 ? Number(config.duration) : videoDuration(sourcePath);
validateSeekability(sourcePath, duration);
const components = await loadComponentCatalog({ root });
const componentIndex = catalogById(components);
const allBeats = validateBeats(
  readJsonArray(path.join(jobDir, "data", "beats.json")),
  componentIndex,
  format
);
const allCaptions = readJsonArray(path.join(jobDir, "data", "captions.json"));
const rawBroll = readJsonArray(path.join(jobDir, "data", "broll.json"));
const truncateTimeline = Boolean(config.truncateTimeline);
const beats = truncateTimeline ? trimBeats(allBeats, duration) : allBeats;
const timelineCaptions = truncateTimeline ? trimCaptions(allCaptions, duration) : allCaptions;
const captions = config.caption?.singleLine
  ? splitCaptionsToSingleLines(timelineCaptions, Number(config.caption.maxCharsPerLine) || 14)
  : timelineCaptions;
const broll = validateBroll(truncateTimeline ? trimBroll(rawBroll, duration) : rawBroll, duration);
const intro = normalizeIntro(config.intro, duration);
const outputHtmlPath = path.join(jobDir, args.output || "index.html");
const cardRanges = beats.map((beat) => ({ start: beat.start, end: beat.end }));

function loadTheme(requested) {
  const registry = readJson(path.join(root, "themes", "registry.json"));
  const id = requested || registry.default;
  if (!registry.themes.includes(id)) {
    console.error(`未注册的主题: ${id}(可用: ${registry.themes.join(", ")})`);
    process.exit(1);
  }
  const dir = path.join(root, "themes", id);
  const data = readJson(path.join(dir, "theme.json"));
  const overridesPath = path.join(dir, "overrides.css");
  data.overridesCss = fs.existsSync(overridesPath) ? fs.readFileSync(overridesPath, "utf8") : "";
  data.dir = dir;
  return data;
}

function validateBeats(items, byId, targetFormat) {
  if (!items.length) return [];
  const errors = [];
  items.forEach((beat, index) => {
    const label = `beats[${index}](${beat.type || "?"} @${beat.start ?? "?"})`;
    const component = byId.get(beat.type);
    const formats = beatFormats(beat, label, errors);
    if (!component) errors.push(`${label}: 未注册 type，可用 ${[...byId.keys()].join("/")}`);
    if (!(Number(beat.end) > Number(beat.start))) errors.push(`${label}: 需要 end > start`);
    if (!beat.kicker) errors.push(`${label}: 缺 kicker`);
    if (!beat.title) errors.push(`${label}: 缺 title`);
    for (const field of component?.requiredFields || []) {
      if (beat[field] == null) errors.push(`${label}: 缺 ${field}`);
    }
    if (component) {
      const componentErrors = component.validate(beat);
      if (!Array.isArray(componentErrors)) errors.push(`${label}: validate 必须返回错误数组`);
      else for (const error of componentErrors) errors.push(`${label}: ${error}`);
    }
    const unsupported = formats.filter((item) => component && !component.formats.includes(item));
    if (unsupported.length) {
      errors.push(`${label}: 组件 ${beat.type} 不支持 ${unsupported.join("/")} 画幅`);
    }
  });
  if (errors.length) {
    console.error("beats.json 校验失败:");
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const sorted = items
    .filter((beat) => (beat.formats || COMPONENT_FORMATS).includes(targetFormat))
    .sort((a, b) => a.start - b.start);
  sorted.forEach((beat, index) => {
    const next = sorted[index + 1];
    if (next && next.start < beat.end - 0.01) {
      console.warn(`警告: 拍子时间重叠 ${beat.title} ↔ ${next.title}`);
    }
  });
  return sorted;
}

function beatFormats(beat, label, errors) {
  if (beat.formats == null) return COMPONENT_FORMATS;
  if (!Array.isArray(beat.formats) || !beat.formats.length) {
    errors.push(`${label}: formats 必须是非空数组`);
    return [];
  }
  const invalid = beat.formats.filter((item) => !COMPONENT_FORMATS.includes(item));
  if (invalid.length) errors.push(`${label}: formats 包含无效值 ${invalid.join("/")}`);
  if (new Set(beat.formats).size !== beat.formats.length) errors.push(`${label}: formats 不允许重复`);
  return beat.formats;
}

function resolveFormat(project, canvasWidth, canvasHeight) {
  const layout = String(project.layout || "").toLowerCase();
  return layout === "horizontal" || canvasWidth > canvasHeight ? "landscape" : "portrait";
}

function trimBeats(items, totalDuration) {
  return items
    .filter((item) => Number(item.start) < totalDuration)
    .map((item) => ({ ...item, end: Math.min(Number(item.end), totalDuration) }))
    .filter((item) => item.end > Number(item.start));
}

function trimCaptions(items, totalDuration) {
  return items
    .filter((item) => captionStart(item) < totalDuration)
    .map((item) => ({ ...item, e: Math.min(captionEnd(item), totalDuration) }))
    .filter((item) => Number(item.e) > captionStart(item));
}

function trimBroll(items, totalDuration) {
  return items
    .filter((item) => Number(item.start) < totalDuration)
    .map((item) => ({ ...item, end: Math.min(Number(item.end), totalDuration) }))
    .filter((item) => Number(item.end) > Number(item.start));
}

function normalizeIntro(value, totalDuration) {
  if (!value?.enabled) return null;
  const mode = String(value.mode || "title-slam");
  if (!["title-slam", "floating-object"].includes(mode)) {
    throw new Error(`intro.mode 不支持 ${mode}`);
  }
  const minimumDuration = mode === "floating-object" ? 1.4 : 4.2;
  const defaultDuration = mode === "floating-object" ? 1.45 : 5.2;
  const flow = Array.isArray(value.flow) ? value.flow.map(String).filter(Boolean).slice(0, 5) : [];
  const data = {
    mode,
    duration: Math.min(Math.max(minimumDuration, Number(value.duration) || defaultDuration), totalDuration),
    asset: value.asset ? String(value.asset) : null,
    number: String(value.number || "50"),
    series: String(value.series || "天 · 50个AI应用"),
    episode: String(value.episode || "DAY 01 / 50"),
    title: String(value.title || config.title || ""),
    flow
  };
  if (!data.title) throw new Error("intro 需要 title");
  if (mode === "title-slam" && !data.flow.length) throw new Error("title-slam intro 需要至少一个 flow 项");
  return data;
}

function validateBroll(items, totalDuration) {
  const errors = [];
  const sorted = [...items].sort((a, b) => Number(a.start) - Number(b.start));
  let total = 0;
  sorted.forEach((item, index) => {
    const label = `broll[${index}](${item.id || item.src || "?"})`;
    const start = Number(item.start);
    const end = Number(item.end);
    const itemDuration = end - start;
    if (!item.src) errors.push(`${label}: 缺 src`);
    if (!item.intent) errors.push(`${label}: 缺 intent(这段画面帮助观众理解什么)`);
    if (!item.reason) errors.push(`${label}: 缺 reason(为什么此刻需要 B-roll)`);
    if (!(end > start)) errors.push(`${label}: 需要 end > start`);
    if (start < 3 && !item.allowHook) errors.push(`${label}: 前 3 秒默认禁止 B-roll；必要时显式 allowHook`);
    if (itemDuration > 10) errors.push(`${label}: 单段不能超过 10 秒`);
    if (!["fullscreen-pip", "fullscreen"].includes(item.mode || "fullscreen-pip")) {
      errors.push(`${label}: mode 只能是 fullscreen-pip/fullscreen`);
    }
    if (!["rounded", "circle"].includes(item.pipShape || "rounded")) {
      errors.push(`${label}: pipShape 只能是 rounded/circle`);
    }
    const mediaPath = item.src ? path.join(jobDir, item.src) : "";
    if (item.src && !fs.existsSync(mediaPath)) errors.push(`${label}: 素材不存在 ${item.src}`);
    total += Math.max(0, itemDuration);
    const next = sorted[index + 1];
    if (next && Number(next.start) < end - 0.01) errors.push(`${label}: 不允许 B-roll 重叠`);
  });
  if (totalDuration > 0 && total / totalDuration > 0.25) {
    errors.push(`B-roll 总占比 ${(total / totalDuration * 100).toFixed(1)}% 超过 25%`);
  }
  if (errors.length) throw new Error(`broll.json 校验失败:\n- ${errors.join("\n- ")}`);
  return sorted;
}

function validateSeekability(file, totalDuration) {
  if (totalDuration <= 2) return;
  const result = run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-skip_frame", "nokey",
    "-show_frames",
    "-show_entries", "frame=pts_time",
    "-of", "csv=p=0",
    file
  ], { capture: true });
  const times = result.stdout
    .split(/\r?\n/)
    .map((line) => Number.parseFloat(line))
    .filter(Number.isFinite);
  const gaps = times.slice(1).map((time, index) => time - times[index]);
  if (times.length) gaps.push(totalDuration - times.at(-1));
  const maxGap = gaps.length ? Math.max(...gaps) : totalDuration;
  if (maxGap > 2.05) {
    throw new Error(`A-roll 最大关键帧间隔 ${maxGap.toFixed(2)}s，HyperFrames seek 会黑帧。请先用 roughcut:render 生成 1 秒 GOP 的干净母版。`);
  }
}

function stageAssets() {
  const sharedFonts = path.join(root, "themes", "_shared", "fonts");
  for (const font of theme.fonts || []) {
    copyOrLink(path.join(sharedFonts, font.file), path.join(jobDir, "assets", "fonts", font.file));
  }
  copyOrLink(
    path.join(root, "themes", "_shared", "vendor", "gsap.min.js"),
    path.join(jobDir, "vendor", "gsap.min.js")
  );
  cjkFontStaged = stageCjkSubset();
}

// 各平台的系统中文字体源；FACTORY_CJK_FONT 环境变量可覆盖。
function cjkFontSource() {
  const override = process.env.FACTORY_CJK_FONT;
  if (override && fs.existsSync(override)) return override;
  const candidates = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc", // macOS
    path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "msyh.ttc"), // Windows 微软雅黑
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc" // Linux Noto
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

// 子集化失败不阻断出片：跳过后字幕回退系统字体渲染，确定性渲染建议装 fonttools。
function stageCjkSubset() {
  const source = cjkFontSource();
  if (!source) {
    console.warn("WARN 跳过中文字体子集化: 未找到系统中文字体源(可用 FACTORY_CJK_FONT 指定)。字幕将回退系统字体。");
    return false;
  }
  if (!commandOk("pyftsubset", ["--help"]).ok) {
    console.warn("WARN 跳过中文字体子集化: 缺少 pyftsubset(pip install fonttools)。字幕将回退系统字体。");
    return false;
  }
  const textFile = path.join(jobDir, "tmp", "factory-cjk-chars.txt");
  const output = path.join(jobDir, "assets", "fonts", "FactoryCJK.woff2");
  const text = JSON.stringify({ title: config.title, beats, captions, broll, intro });
  fs.mkdirSync(path.dirname(textFile), { recursive: true });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(textFile, text);
  run("pyftsubset", [
    source,
    "--font-number=0",
    `--text-file=${textFile}`,
    "--flavor=woff2",
    `--output-file=${output}`,
    "--layout-features=*",
    "--no-hinting"
  ], { capture: true });
  return true;
}

function copyOrLink(src, dest) {
  if (fs.existsSync(dest)) return;
  if (!fs.existsSync(src)) {
    console.error(`缺少共享资产: ${src}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.linkSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
  }
}

function overlaps(start, end, ranges) {
  return ranges.some((range) => start < range.end && end > range.start);
}

function captionStart(item) {
  return Number(item.s ?? item.start);
}

function captionEnd(item) {
  return Number(item.e ?? item.end ?? captionStart(item) + Number(item.duration || 0));
}

function splitCaptionsToSingleLines(items, maxChars) {
  const limit = Math.max(6, Math.floor(maxChars));
  return items.flatMap((item) => {
    const text = String(item.t ?? item.text ?? "").replace(/\s+/g, " ").trim();
    const parts = splitCaptionText(text, limit);
    if (parts.length <= 1) return [{ ...item, t: text }];

    const start = captionStart(item);
    const end = captionEnd(item);
    const weights = parts.map((part) => Math.max(1, captionDisplayWidth(part)));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let consumedWeight = 0;
    return parts.map((part, index) => {
      const partStart = start + ((end - start) * consumedWeight) / totalWeight;
      consumedWeight += weights[index];
      const partEnd = index === parts.length - 1
        ? end
        : start + ((end - start) * consumedWeight) / totalWeight;
      return { ...item, s: partStart, e: partEnd, t: part };
    });
  });
}

function splitCaptionText(text, limit) {
  if (!text || captionDisplayWidth(text) <= limit) return text ? [text] : [];
  const clauses = text.match(/[^，。！？；：,.!?;:]+[，。！？；：,.!?;:]?/gu) || [text];
  const parts = [];
  let pending = "";

  clauses.forEach((clause) => {
    const candidate = `${pending}${clause}`;
    if (captionDisplayWidth(candidate) <= limit) {
      pending = candidate;
      return;
    }
    if (pending) parts.push(pending.trim());
    const chunks = splitCaptionClause(clause.trim(), limit);
    parts.push(...chunks.slice(0, -1));
    pending = chunks.at(-1) || "";
  });
  if (pending) parts.push(pending);
  return parts.filter(Boolean);
}

function splitCaptionClause(text, limit) {
  const units = text.match(/[A-Za-z0-9]+(?:[._/+&#'-][A-Za-z0-9]+)*|\s+|./gu) || [];
  const totalWidth = captionDisplayWidth(text);
  const chunkCount = Math.max(1, Math.ceil(totalWidth / limit));
  const chunks = [];
  let pending = "";
  let consumedWidth = 0;
  units.forEach((unit) => {
    const candidate = `${pending}${unit}`;
    const isClosingPunctuation = /^[，。！？；：,.!?;:、）】》]/u.test(unit);
    const chunksLeft = chunkCount - chunks.length;
    const targetWidth = (totalWidth - consumedWidth) / chunksLeft;
    const pendingWidth = captionDisplayWidth(pending);
    const candidateWidth = captionDisplayWidth(candidate);
    const beforeDelta = Math.abs(targetWidth - pendingWidth);
    const afterDelta = Math.abs(targetWidth - candidateWidth);
    const shouldBreak = pending && chunksLeft > 1 && !isClosingPunctuation
      && (candidateWidth > limit || (candidateWidth > targetWidth && beforeDelta <= afterDelta));
    if (shouldBreak) {
      chunks.push(pending.trim());
      consumedWidth += pendingWidth;
      pending = unit.trimStart();
      return;
    }
    pending = candidate;
  });
  if (pending.trim()) chunks.push(pending.trim());
  return chunks;
}

function captionDisplayWidth(text) {
  return Array.from(text).reduce((width, char) => {
    if (/\s/u.test(char)) return width + 0.35;
    if (/[A-Za-z0-9]/u.test(char)) return width + 0.56;
    if (/[^\p{L}\p{N}]/u.test(char) && char.codePointAt(0) < 128) return width + 0.45;
    return width + 1;
  }, 0);
}

function renderCaptions() {
  if (config.caption && config.caption.enabled === false) return "";
  return captions
    .map((item, index) => {
      const start = captionStart(item);
      const end = captionEnd(item);
      const dur = Math.max(0.1, end - start);
      const text = String(item.t ?? item.text ?? "").trim();
      if (!text) return "";
      const placement = overlaps(start, end, cardRanges) ? " caption-over-card" : "";
      return `<div id="caption-${index + 1}" class="clip caption${placement}" data-start="${fmtTime(start)}" data-duration="${fmtTime(dur)}" data-track-index="${1000 + index}">${escapeHtml(text)}</div>`;
    })
    .filter(Boolean)
    .join("");
}

function renderBeat(beat, index) {
  const id = `beat-${String(index + 1).padStart(2, "0")}`;
  const dur = beat.end - beat.start;
  const base = `id="${id}" class="clip beat beat-${beat.type}" data-kind="${beat.type}" data-start="${fmtTime(beat.start)}" data-duration="${fmtTime(dur)}" data-track-index="${100 + index}"`;
  const content = componentIndex.get(beat.type).render(beat);
  if (typeof content !== "string" || !content.trim()) throw new Error(`组件 ${beat.type} 未渲染出 HTML`);
  return `<section ${base}>${content}</section>`;
}

function renderBroll(item, index) {
  const start = Number(item.start);
  const dur = Number(item.end) - start;
  const mode = item.mode || "fullscreen-pip";
  const id = `broll-${String(index + 1).padStart(2, "0")}`;
  const mediaAttrs = `id="${id}" class="clip broll broll-${mode}" src="${escapeHtml(item.src)}" data-start="${fmtTime(start)}" data-duration="${fmtTime(dur)}" data-track-index="${20 + index}" data-mode="${mode}" data-pip-shape="${escapeHtml(item.pipShape || "rounded")}"`;
  const media = /\.(png|jpe?g|webp|avif)$/i.test(item.src)
    ? `<img ${mediaAttrs} />`
    : `<video ${mediaAttrs} muted playsinline preload="auto"></video>`;
  return media;
}

function introObjectDataUri() {
  const t = theme.tokens;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="438" height="582" viewBox="0 0 438 582">
    <defs><filter id="shadow" x="-30%" y="-20%" width="160%" height="170%"><feDropShadow dx="0" dy="24" stdDeviation="24" flood-color="#12100c" flood-opacity="0.30"/></filter></defs>
    <g filter="url(#shadow)">
      <rect x="2" y="2" width="434" height="578" rx="34" fill="${t.cardBg}" stroke="${t.cardBorder}" stroke-width="2"/>
      <rect x="24" y="24" width="390" height="326" rx="25" fill="${t.chipBg}" stroke="${t.chipBorder}"/>
      <rect x="333" y="42" width="67" height="32" rx="9" fill="${t.mutedBg}"/>
      <text x="366.5" y="64" text-anchor="middle" fill="${t.textBody}" font-family="Inter,Arial,sans-serif" font-size="18" font-weight="700" letter-spacing="0.7">${escapeHtml(intro.episode)}</text>
      <text x="213" y="292" text-anchor="middle" fill="${t.text}" font-family="Inter,Arial,sans-serif" font-size="188" font-weight="700" letter-spacing="-12">${escapeHtml(intro.number)}</text>
      <text x="31" y="392" fill="${t.textBody}" font-family="PingFang SC,Hiragino Sans GB,Arial,sans-serif" font-size="29" font-weight="700" letter-spacing="-0.7">${escapeHtml(intro.series)}</text>
      <text x="31" y="451" fill="${t.text}" font-family="PingFang SC,Hiragino Sans GB,Arial,sans-serif" font-size="36" font-weight="700" letter-spacing="-1">${escapeHtml(intro.title)}</text>
    </g>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function renderIntro() {
  if (!intro) return "";
  const clipAttrs = `class="clip intro-overlay" data-start="0" data-duration="${fmtTime(intro.duration)}" data-track-index="6"`;
  if (intro.mode === "floating-object") {
    const objectSrc = intro.asset ? escapeHtml(intro.asset) : introObjectDataUri();
    return `<div id="intro-host" ${clipAttrs} aria-hidden="true">
        <div id="intro-object-wrap" data-layout-allow-overflow>
          <img id="intro-object" src="${objectSrc}" alt="" />
        </div>
      </div>`;
  }
  const flow = intro.flow
    .map((item, index) => `<span class="intro-flow-item" data-intro-flow="${index + 1}">${escapeHtml(item)}</span>`)
    .join('<i class="intro-flow-arrow">→</i>');
  return `<div id="intro-host" ${clipAttrs} aria-hidden="true">
        <div id="intro-surface"></div>
        <div id="intro-glow" data-layout-allow-overflow></div>
        <div id="intro-rule-x"></div>
        <div id="intro-rule-y"></div>
        <div id="intro-copy">
          <div id="intro-series"><span id="intro-series-number">${escapeHtml(intro.number)}</span><span id="intro-series-rest">${escapeHtml(intro.series)}</span></div>
          <h1 id="intro-main-title">${escapeHtml(intro.title)}</h1>
          <div id="intro-flow">${flow}</div>
          <div id="intro-progress"><b id="intro-progress-fill"></b></div>
          <div id="intro-meta">OPEN SOURCE · PRODUCT SYSTEM · 2026</div>
        </div>
        <div id="day-anchor"><span>${escapeHtml(intro.episode)}</span><i></i></div>
      </div>`;
}

function fontFaces() {
  const themed = (theme.fonts || [])
    .map(
      (font) =>
        `@font-face { font-family: "${font.family}"; src: url("assets/fonts/${font.file}") format("woff2"); font-weight: ${font.weight}; }`
    )
    .join("\n      ");
  if (!cjkFontStaged) return themed;
  return `@font-face { font-family: "FactoryCJK"; src: url("assets/fonts/FactoryCJK.woff2") format("woff2"); font-weight: 100 900; }\n      ${themed}`;
}

function themeCss() {
  const t = theme.tokens;
  const fontHead = deterministicFontStack(t.fontHead);
  const fontBody = deterministicFontStack(t.fontBody);
  const componentCss = renderComponentStyles(components, { ...t, fontBody });
  return `* { box-sizing: border-box; }
      html, body { margin: 0; width: 100%; height: 100%; background: ${t.pageBg}; }
      #main { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: ${t.pageBg}; color: ${t.text}; font-family: ${fontHead}; letter-spacing: 0; }
      #video-wrap { position: absolute; inset: 0; z-index: 3; overflow: hidden; transform-origin: center center; will-change: transform, filter, opacity; }
      #talking-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: saturate(1.02) contrast(1.02); }
      #pip-ring { position: absolute; top: ${Math.round(height * 0.115)}px; right: ${Math.round(width * 0.046)}px; z-index: 3; width: ${Math.round(width * 0.296)}px; height: ${Math.round(width * 0.296)}px; border: ${Math.max(4, Math.round(width * 0.0055))}px solid ${t.accent}; border-radius: 50%; opacity: 0; visibility: hidden; pointer-events: none; box-shadow: 0 18px 54px rgba(0, 0, 0, 0.46); }
      #talking-audio { display: none; }
      #broll-host { position: absolute; inset: 0; z-index: 2; overflow: hidden; }
      .broll { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: ${t.pageBg}; }
      #scrim { position: absolute; inset: 0; z-index: 2; pointer-events: none; opacity: 0; background: ${t.scrim}; }
      .vignette { position: absolute; inset: 0; z-index: 3; pointer-events: none; background: ${t.vignette}; }
      .clip { opacity: 0; visibility: hidden; }
      #card-host { position: absolute; inset: 0; z-index: 4; pointer-events: none; }
      .beat { position: absolute; left: 46px; right: 46px; bottom: 54px; max-height: 360px; padding: 20px 24px; border-radius: ${t.radius}; border: 1px solid ${t.cardBorder}; background: ${t.cardBg}; box-shadow: ${t.cardShadow}; backdrop-filter: blur(${t.cardBlur}); overflow: hidden; }
      .beat::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 3px; background: ${t.cardTopline}; }
      .kicker { color: ${t.kicker}; font-size: 20px; line-height: 1; font-weight: 700; margin-bottom: 8px; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.36); }
      h2 { margin: 0; max-width: 960px; font-size: 38px; line-height: 1.06; font-weight: 700; }
      p { margin: 10px 0 0; max-width: 900px; color: ${t.textBody}; font-family: ${fontBody}; font-size: 25px; line-height: 1.16; }
      ${componentCss}
      .caption { position: absolute; left: 64px; right: 64px; bottom: 148px; z-index: 5; color: ${t.captionText}; font-size: 40px; line-height: 1.12; font-weight: 700; text-align: center; text-shadow: ${t.captionShadow}; }
      .caption-over-card { bottom: 430px; font-size: 38px; }
      ${introCss()}
      ${layoutCss()}`;
}

function introCss() {
  if (!intro) return "";
  const t = theme.tokens;
  if (intro.mode === "floating-object") {
    return `#intro-host { position: absolute; inset: 0; z-index: 6; overflow: hidden; pointer-events: none; }
      #intro-object-wrap { position: absolute; left: 142px; top: 166px; width: 438px; height: 582px; transform-origin: 46% 54%; will-change: transform, opacity; }
      #intro-object { display: block; width: 100%; height: 100%; }`;
  }
  return `#intro-host { position: absolute; inset: 0; z-index: 6; overflow: hidden; pointer-events: none; }
      #intro-surface { position: absolute; inset: 0; background: ${t.pageBg}; opacity: 0; }
      #intro-glow { position: absolute; left: -180px; top: -220px; width: 1120px; height: 1120px; border-radius: 50%; opacity: 0; transform-origin: 42% 48%; background: radial-gradient(circle, rgba(159, 194, 214, 0.24) 0%, rgba(159, 194, 214, 0.08) 38%, rgba(13, 20, 28, 0) 70%); }
      #intro-rule-x { position: absolute; left: 0; right: 0; top: 116px; height: 2px; background: rgba(159, 194, 214, 0.28); transform-origin: left center; }
      #intro-rule-y { position: absolute; left: 88px; top: 0; bottom: 0; width: 2px; background: rgba(159, 194, 214, 0.22); transform-origin: center top; }
      #intro-copy { position: absolute; left: 120px; right: 96px; top: 188px; color: ${t.text}; }
      #intro-series { display: flex; align-items: baseline; min-height: 250px; white-space: nowrap; overflow: visible; }
      #intro-series-number { display: inline-block; color: ${t.text}; font-family: Inter, FactoryCJK, sans-serif; font-size: 260px; line-height: 0.82; font-weight: 700; letter-spacing: -0.04em; transform-origin: left center; will-change: transform, filter, opacity; }
      #intro-series-rest { display: inline-block; margin-left: 30px; color: ${t.text}; font-family: Inter, FactoryCJK, sans-serif; font-size: 106px; line-height: 0.92; font-weight: 700; letter-spacing: -0.035em; will-change: transform, filter, opacity; }
      #intro-main-title { display: block; width: 100%; margin: 30px 0 0; color: ${t.text}; font-size: 76px; line-height: 1.02; font-weight: 700; letter-spacing: -0.03em; will-change: transform, opacity; }
      #intro-flow { display: flex; align-items: center; gap: 18px; margin-top: 42px; color: ${t.textBody}; font-size: 31px; line-height: 1; font-weight: 700; }
      .intro-flow-item, .intro-flow-arrow { display: inline-block; will-change: transform, opacity; }
      .intro-flow-arrow { color: ${t.accent}; font-style: normal; }
      #intro-progress { width: 760px; height: 4px; margin-top: 38px; background: rgba(159, 194, 214, 0.18); overflow: hidden; }
      #intro-progress-fill { display: block; width: 100%; height: 100%; background: ${t.accent}; transform-origin: left center; }
      #intro-meta { margin-top: 20px; color: ${t.kicker}; font-family: Inter, sans-serif; font-size: 20px; line-height: 1; letter-spacing: 0.12em; }
      #day-anchor { position: absolute; left: 120px; top: 96px; width: 230px; height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; color: ${t.text}; background: rgba(22, 30, 40, 0.94); border: 1px solid rgba(159, 194, 214, 0.42); border-radius: 14px; transform-origin: left top; will-change: transform, opacity; }
      #day-anchor span { font-family: Inter, sans-serif; font-size: 21px; font-weight: 700; letter-spacing: 0.04em; }
      #day-anchor i { display: block; width: 9px; height: 9px; border-radius: 50%; background: ${t.accent}; box-shadow: 0 0 0 5px rgba(232, 84, 47, 0.16); }`;
}

function deterministicFontStack(stack) {
  const banned = /^("?)(PingFang SC|Noto Sans SC|Songti SC|STSong)\1$/i;
  const remaining = String(stack || "sans-serif")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && !banned.test(item));
  return (cjkFontStaged ? ["FactoryCJK", ...remaining] : remaining).join(", ");
}

function layoutCss() {
  if (sourcePreserve) {
    return `#main { background: ${theme.tokens.text}; }
      #video-wrap { inset: 0; overflow: hidden; background: ${theme.tokens.text}; }
      #talking-video { object-fit: contain; object-position: 50% 50%; filter: saturate(1.01) contrast(1.01); }
      .vignette { display: none; }
      #card-host { z-index: 8; }
      .beat { left: 66px; right: auto; top: 72px; bottom: auto; width: 540px; max-height: 280px; padding: 18px 22px; border: 0; border-radius: 12px; background: rgba(13, 20, 28, 0.88); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.34); }
      .beat::before { height: 2px; background: ${theme.tokens.accent}; }
      .beat .kicker { font-size: 17px; margin-bottom: 7px; }
      .beat h2 { font-size: 34px; line-height: 1.08; }
      .beat p { font-size: 21px; line-height: 1.18; }
      .beat .hero-number { right: 18px; bottom: 16px; font-size: 66px; }
      .caption, .caption-over-card { left: calc(50% - 60px); right: auto; bottom: 52px; width: 720px; max-width: calc(100% - 160px); transform: translateX(-50%); font-size: 43px; line-height: 1.14; text-align: center; white-space: nowrap; }
      .cta-row span { font-size: 19px; }
      .beat-cta { top: auto; bottom: 104px; width: 650px; }`;
  }
  if ((config.layout || "").toLowerCase() !== "horizontal" && width <= height) return "";
  return `#main { background: ${theme.tokens.pageBg}; }
      #video-wrap { top: 0; right: 0; bottom: 0; left: 56%; overflow: hidden; }
      #talking-video { object-position: 50% 42%; }
      .vignette { background: linear-gradient(90deg, ${theme.tokens.pageBg} 0%, ${theme.tokens.pageBg} 48%, transparent 72%); }
      .beat { left: 72px; right: 50%; bottom: auto; top: 50%; max-height: 620px; transform: translateY(-50%); padding: 30px 34px; }
      .beat h2 { font-size: 48px; }
      .beat p { font-size: 28px; }
      .caption { left: 57%; right: 3%; bottom: 80px; font-size: 34px; }
      .caption-over-card { bottom: 80px; font-size: 34px; }`;
}

function inlineGsap() {
  const gsapPath = path.join(jobDir, "vendor", "gsap.min.js");
  const source = fs
    .readFileSync(gsapPath, "utf8")
    .replaceAll("Math.random()", "0.5")
    .replaceAll("</script", "<\\/script");
  return `<script>${source}</script>`;
}

function introTimelineJs() {
  if (!intro) return "";
  if (intro.mode === "floating-object") {
    const exitStart = Math.max(0.9, intro.duration - 0.34);
    const exitEnd = Math.max(exitStart + 0.2, intro.duration - 0.03);
    return `
      tl.fromTo("#intro-object-wrap", { x: -104, y: 14, scale: 1.20, rotation: -4.4, opacity: 0 }, { x: 0, y: 0, scale: 1, rotation: -1.2, opacity: 1, duration: 0.36, ease: "expo.out" }, 0.06);
      tl.to("#intro-object-wrap", { y: -6, rotation: -0.7, duration: 1.9, repeat: 1, yoyo: true, ease: "sine.inOut" }, 0.50);
      tl.to("#intro-object-wrap", { x: -620, duration: 0.31, ease: "expo.in" }, ${fmtTime(exitStart)});
      tl.set("#intro-object-wrap", { autoAlpha: 0 }, ${fmtTime(exitEnd)});
    `;
  }
  const anchorScale = 0.78;
  const anchorX = Math.round(width - 56 - 230 * anchorScale - 120);
  const anchorY = 52 - 96;
  return `
      tl.fromTo("#intro-surface", { opacity: 0 }, { opacity: 0.96, duration: 0.22, ease: "power2.out" }, 0.08);
      tl.fromTo("#intro-glow", { opacity: 0, scale: 0.74 }, { opacity: 1, scale: 1, duration: 1.10, ease: "sine.out" }, 0.16);
      tl.fromTo("#intro-rule-x", { scaleX: 0 }, { scaleX: 1, duration: 0.64, ease: "expo.out" }, 0.22);
      tl.fromTo("#intro-rule-y", { scaleY: 0 }, { scaleY: 1, duration: 0.88, ease: "circ.out" }, 0.34);
      tl.fromTo("#intro-series-number", { scale: 1.72, filter: "blur(14px)", opacity: 0 }, { scale: 1, filter: "blur(0px)", opacity: 1, duration: 0.46, ease: "power4.out" }, 0.18);
      tl.fromTo("#intro-series-rest", { x: -190, filter: "blur(7px)", opacity: 0 }, { x: 0, filter: "blur(0px)", opacity: 1, duration: 0.52, ease: "expo.out" }, 0.52);
      tl.fromTo("#intro-main-title", { y: 92, opacity: 0 }, { y: 0, opacity: 1, duration: 0.72, ease: "circ.out" }, 0.94);
      tl.fromTo("#intro-flow .intro-flow-item, #intro-flow .intro-flow-arrow", { x: 28, opacity: 0 }, { x: 0, opacity: 1, duration: 0.42, stagger: 0.055, ease: "power3.out" }, 1.34);
      tl.fromTo("#intro-progress-fill", { scaleX: 0 }, { scaleX: 1, duration: 2.10, ease: "expo.out" }, 1.28);
      tl.fromTo("#intro-meta", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.46, ease: "power2.out" }, 1.58);
      tl.fromTo("#day-anchor", { y: 16, scale: 0.94, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.58, ease: "power4.out" }, 1.02);
      tl.set(videoWrap, { scale: 1.045, filter: "blur(7px)", opacity: 0.64 }, 0);
      tl.to("#intro-flow", { x: 18, opacity: 0, duration: 0.20, ease: "power3.in" }, 3.46);
      tl.to("#intro-meta", { y: -10, opacity: 0, duration: 0.18, ease: "power3.in" }, 3.48);
      tl.to("#intro-main-title", { y: -24, scale: 0.985, opacity: 0, duration: 0.28, ease: "power3.in" }, 3.58);
      tl.to("#intro-series", { scale: 0.96, filter: "blur(4px)", opacity: 0, duration: 0.32, ease: "power3.in" }, 3.64);
      tl.to("#intro-progress", { scaleX: 0, opacity: 0, duration: 0.22, ease: "power3.in", transformOrigin: "right center" }, 3.56);
      tl.to("#intro-rule-x, #intro-rule-y", { opacity: 0, duration: 0.32, ease: "sine.in" }, 3.58);
      tl.to("#intro-glow", { opacity: 0, scale: 1.08, duration: 0.54, ease: "sine.in" }, 3.62);
      tl.to("#intro-surface", { opacity: 0, duration: 0.82, ease: "sine.inOut" }, 3.72);
      tl.to(videoWrap, { scale: 1, filter: "blur(0px)", opacity: 1, duration: 0.96, ease: "expo.inOut" }, 3.68);
      tl.to("#day-anchor", { x: ${anchorX}, y: ${anchorY}, scale: ${anchorScale}, duration: 0.92, ease: "expo.inOut" }, 3.66);
      tl.set("#intro-copy, #intro-rule-x, #intro-rule-y, #intro-glow", { autoAlpha: 0 }, 4.05);
  `;
}

function writeMotionSpec() {
  const motionPath = path.join(jobDir, "index.motion.json");
  if (!intro) {
    fs.rmSync(motionPath, { force: true });
    return;
  }
  const spec = {
    duration: Math.min(duration, intro.duration),
    assertions: intro.mode === "floating-object"
      ? [
          { kind: "appearsBy", selector: "#intro-object-wrap", bySec: 0.48 },
          { kind: "staysInFrame", selector: "#intro-object-wrap" }
        ]
      : [
          { kind: "appearsBy", selector: "#intro-series-number", bySec: 0.72 },
          { kind: "appearsBy", selector: "#intro-series-rest", bySec: 1.12 },
          { kind: "appearsBy", selector: "#intro-main-title", bySec: 1.78 },
          { kind: "before", a: "#intro-series-number", b: "#intro-main-title" },
          { kind: "staysInFrame", selector: "#day-anchor" }
        ]
  };
  fs.writeFileSync(motionPath, `${JSON.stringify(spec, null, 2)}\n`);
}

function renderHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:," />
    ${cjkFontStaged ? '<link rel="preload" href="assets/fonts/FactoryCJK.woff2" as="font" type="font/woff2" crossorigin />' : ""}
    <title>${escapeHtml(config.title || "口播成片")} - ${escapeHtml(theme.label)}</title>
    <style>
      ${fontFaces()}
      ${themeCss()}
      ${sourcePreserve ? "" : theme.overridesCss}
    </style>
  </head>
  <body>
    <div id="main" data-composition-id="main" data-width="${width}" data-height="${height}" data-start="0" data-duration="${fmtTime(duration)}">
      <div id="video-wrap">
        <video id="talking-video" src="${escapeHtml(sourceVideo)}" data-start="0" data-duration="${fmtTime(duration)}" data-track-index="1" muted playsinline preload="auto"></video>
      </div>
      <audio id="talking-audio" src="${escapeHtml(sourceVideo)}" data-start="0" data-duration="${fmtTime(duration)}" data-track-index="2" preload="auto"></audio>
      <div id="broll-host">
        ${broll.map(renderBroll).join("\n        ")}
      </div>
      <div id="pip-ring" aria-hidden="true"></div>
      <div id="scrim"></div>
      <div class="vignette"></div>
      ${renderIntro()}
      <div id="card-host">
        ${beats.map(renderBeat).join("\n        ")}
        ${renderCaptions()}
      </div>
    </div>
    ${inlineGsap()}
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      const videoWrap = document.querySelector("#video-wrap");
      const pipRing = document.querySelector("#pip-ring");
      const scrim = document.querySelector("#scrim");
      tl.set(pipRing, { autoAlpha: 0 }, 0);
      ${introTimelineJs()}
      document.querySelectorAll(".clip").forEach((clip) => {
        const start = Number(clip.dataset.start || 0);
        const dur = Number(clip.dataset.duration || 0);
        if (!Number.isFinite(start) || !Number.isFinite(dur) || dur <= 0) return;
        tl.set(clip, { autoAlpha: 0 }, 0);
        tl.set(clip, { autoAlpha: 1 }, start);
        tl.set(clip, { autoAlpha: 0 }, start + dur);
      });
      document.querySelectorAll(".beat").forEach((card) => {
        const start = Number(card.dataset.start || 0);
        const dur = Number(card.dataset.duration || 0);
        if (${sourcePreserve}) {
          tl.fromTo(card, { x: -34, opacity: 0 }, { x: 0, opacity: 1, duration: 0.46, ease: "expo.out" }, start);
          tl.to(card, { x: 18, opacity: 0, duration: 0.22, ease: "power3.in" }, start + Math.max(0.8, dur - 0.24));
          tl.fromTo(card.querySelectorAll("h2, p, [data-beat-item]"), { x: -12, opacity: 0 }, { x: 0, opacity: 1, duration: 0.32, stagger: 0.035, ease: "power3.out" }, start + 0.10);
        } else {
          tl.from(card, { y: 28, scale: 0.985, duration: 0.36, ease: "expo.out" }, start + 0.08);
          tl.to(card, { y: 16, duration: 0.22, ease: "power3.in" }, start + Math.max(0.8, dur - 0.28));
          tl.from(card.querySelectorAll("h2, p, [data-beat-item]"), { y: 12, opacity: 0, duration: 0.26, stagger: 0.035, ease: "power3.out" }, start + 0.16);
          tl.to(scrim, { opacity: 0.28, duration: 0.24, ease: "sine.out" }, start);
          tl.to(scrim, { opacity: 0, duration: 0.24, ease: "sine.in" }, start + Math.max(0.8, dur - 0.30));
        }
      });
      document.querySelectorAll(".broll").forEach((item) => {
        const start = Number(item.dataset.start || 0);
        const dur = Number(item.dataset.duration || 0);
        const end = start + dur;
        if (item.dataset.mode === "fullscreen") {
          tl.set(videoWrap, { opacity: 0 }, start);
          tl.set(videoWrap, { opacity: 1 }, end);
          return;
        }
        const horizontal = ${width} > ${height};
        const circle = item.dataset.pipShape === "circle" && !horizontal;
        if (circle) {
          tl.set(videoWrap, { clipPath: "circle(100% at 50% 50%)" }, start);
          tl.to(videoWrap, {
            scale: 0.35,
            x: ${width} * 0.306,
            y: -${height} * 0.274,
            clipPath: "circle(${Math.round(width * 0.423)}px at 50% 42%)",
            borderRadius: 0,
            boxShadow: "none",
            filter: "drop-shadow(0 18px 28px rgba(0,0,0,.42))",
            duration: 0.28,
            ease: "power3.out"
          }, start);
          tl.to(pipRing, { autoAlpha: 1, duration: 0.22, ease: "power2.out" }, start + 0.06);
          tl.to(pipRing, { autoAlpha: 0, duration: 0.18, ease: "power2.in" }, Math.max(start, end - 0.24));
          tl.to(videoWrap, {
            scale: 1,
            x: 0,
            y: 0,
            clipPath: "circle(100% at 50% 50%)",
            filter: "none",
            duration: 0.28,
            ease: "power3.inOut"
          }, Math.max(start, end - 0.28));
          tl.set(videoWrap, { clipPath: "none" }, end);
          return;
        }
        tl.to(videoWrap, {
          scale: horizontal ? 1 : 0.27,
          x: horizontal ? 0 : ${width} * 0.32,
          y: horizontal ? 0 : -${height} * 0.34,
          borderRadius: 42,
          boxShadow: "0 18px 60px rgba(0,0,0,.42)",
          duration: 0.28,
          ease: "power3.out"
        }, start);
        tl.to(videoWrap, { scale: 1, x: 0, y: 0, borderRadius: 0, boxShadow: "none", duration: 0.28, ease: "power3.inOut" }, Math.max(start, end - 0.28));
      });
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}

stageAssets();
fs.writeFileSync(outputHtmlPath, renderHtml().replace(/[ \t]+$/gm, ""));
writeMotionSpec();
fs.mkdirSync(path.join(jobDir, "renders"), { recursive: true });
fs.mkdirSync(path.join(jobDir, "qa"), { recursive: true });

const late = beats.filter((beat) => beat.end > duration + 0.5);
if (late.length) console.warn(`警告: ${late.length} 个拍子超出视频时长 ${duration.toFixed(2)}s`);
console.log(`Built ${outputHtmlPath}`);
console.log(`主题: ${theme.id}(${theme.label})`);
console.log(`时长: ${duration.toFixed(3)}s, 画布: ${width}x${height}(${format})`);
console.log(`拍子: ${beats.length}, 字幕: ${captions.length}`);
console.log(`B-roll: ${broll.length}`);
