import fs from "node:fs";
import { commandOk, localBin, projectRoot, whisperModelPath } from "./lib.mjs";

// ============================================================
// 环境体检:分两档
//   core         缺任一 → exit 1(没有它渲染链根本跑不起来)
//   full-pipeline 只在本地转录/字幕子集化时需要,缺了只 warn,exit 0
// ============================================================
const root = projectRoot();
let coreFailed = false;

const HINT = {
  whisper: {
    mac: "brew install whisper-cpp",
    win: "从 https://github.com/ggml-org/whisper.cpp/releases 下预编译包,加入 PATH"
  },
  model: "下载 ggml-large-v3-turbo.bin 到 ~/.cache/whisper-cpp/(或用 WHISPER_MODEL 指向已有模型)\n         https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
  pyftsubset: {
    mac: "pip3 install fonttools",
    win: "pip install fonttools"
  }
};

console.log("== 核心依赖(缺失即阻断) ==");
checkNode();
checkCore("npm", ["--version"], "npm");
checkCore("ffmpeg", ["-version"], "FFmpeg");
checkCore("ffprobe", ["-version"], "FFprobe");
checkHyperframes();

console.log("\n== 完整流水线(仅本地转录/字幕子集需要,缺失只提示) ==");
warn("whisper-cli", ["--help"], "whisper.cpp", platformHint(HINT.whisper));
warnWhisperModel();
warn("pyftsubset", ["--help"], "fonttools subset(字幕子集化)", platformHint(HINT.pyftsubset));

console.log("\n== 磁盘余量 ==");
checkDisk();

if (coreFailed) {
  console.error("\n核心依赖缺失,请先补齐再运行流水线。");
  process.exit(1);
}
console.log("\n核心依赖齐备。");

// ---- helpers ----
function checkNode() {
  const res = commandOk("node", ["--version"]);
  const major = Number((res.output.match(/v(\d+)\./) || [])[1]);
  if (res.ok && major >= 22) {
    console.log(`OK Node.js ${res.output.split("\n")[0]} (>=22)`);
  } else {
    coreFailed = true;
    console.error(`MISSING Node.js >=22(当前 ${res.output.split("\n")[0] || "未安装"})`);
  }
}

function checkCore(command, args, label) {
  const res = commandOk(command, args);
  if (res.ok) {
    console.log(`OK ${label}: ${res.output.split("\n")[0] || ""}`);
  } else {
    coreFailed = true;
    console.error(`MISSING ${label}: 命令 "${command}" 不可用`);
  }
}

function checkHyperframes() {
  const bin = localBin(root, "hyperframes");
  const res = commandOk(bin, ["--version"]);
  if (res.ok) {
    console.log(`OK HyperFrames: ${res.output.split("\n")[0] || ""}`);
  } else {
    coreFailed = true;
    console.error(`MISSING HyperFrames: ${bin} 不可用(先 npm install)`);
  }
}

function warn(command, args, label, hint) {
  const res = commandOk(command, args);
  if (res.ok) {
    console.log(`OK ${label}: ${res.output.split("\n")[0] || ""}`);
  } else {
    console.warn(`WARN ${label} 缺失(不影响出片,仅本地转录/字幕需要)\n     安装: ${hint}`);
  }
}

function warnWhisperModel() {
  const model = whisperModelPath();
  if (fs.existsSync(model)) {
    console.log(`OK Whisper 模型: ${model}`);
  } else {
    console.warn(`WARN Whisper 模型缺失: ${model}\n     ${HINT.model}`);
  }
}

function checkDisk() {
  try {
    const stat = fs.statfsSync(root);
    const freeGb = (Number(stat.bavail) * Number(stat.bsize)) / 1024 ** 3;
    if (freeGb >= 50) {
      console.log(`OK 磁盘剩余 ${freeGb.toFixed(0)}G`);
    } else {
      console.warn(`WARN 磁盘剩余 ${freeGb.toFixed(1)}G(<50G,渲染前请清理)`);
    }
  } catch (error) {
    console.warn(`WARN 无法检查磁盘余量: ${error.message}`);
  }
}

function platformHint(hint) {
  return process.platform === "win32" ? hint.win : hint.mac;
}
