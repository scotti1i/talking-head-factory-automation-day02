import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================
// 跨平台收口:工具名 / 路径 / 文件管理器差异统一在这里,别处只调用
// ============================================================
const isWindows = process.platform === "win32";

// npm 在 Windows 上是 npm.cmd(spawn 不走 shell 时必须带后缀)
export function npmCmd() {
  return isWindows ? "npm.cmd" : "npm";
}

// node_modules/.bin/<name> 在 Windows 上是 <name>.cmd
export function localBin(root, name) {
  const bin = path.join(root, "node_modules", ".bin", name);
  return isWindows ? `${bin}.cmd` : bin;
}

// 探测可用的 python 解释器:python3 → python → py
let cachedPython = null;
export function pythonCmd() {
  if (cachedPython) return cachedPython;
  for (const cmd of ["python3", "python", "py"]) {
    const probe = spawnSync(cmd, ["--version"], { stdio: "pipe", encoding: "utf8" });
    if (probe.status === 0 && /python/i.test(`${probe.stdout}${probe.stderr}`)) {
      cachedPython = cmd;
      return cmd;
    }
  }
  cachedPython = "python3";
  return cachedPython;
}

// 展开 ~ 前缀为用户主目录(跨平台)
export function expandHome(input) {
  if (typeof input !== "string") return input;
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

// 解析交付根目录:优先配置(支持 ~),否则默认 <home>/Downloads
export function resolveDownloadsRoot(configured) {
  return configured ? expandHome(configured) : path.join(os.homedir(), "Downloads");
}

// whisper 模型路径:显式参数 > WHISPER_MODEL 环境变量 > 默认缓存路径
export function whisperModelPath(override) {
  return path.resolve(
    override
      || process.env.WHISPER_MODEL
      || path.join(os.homedir(), ".cache", "whisper-cpp", "ggml-large-v3-turbo.bin")
  );
}

// 在系统文件管理器里定位/打开路径(win explorer / mac open / linux xdg-open)
export function revealInFileManager(target) {
  const isDir = fs.existsSync(target) && fs.statSync(target).isDirectory();
  if (isWindows) {
    // explorer 成功时也可能返回非 0,故不判返回码
    return spawnSync("explorer", isDir ? [target] : [`/select,${target}`]);
  }
  if (process.platform === "darwin") {
    return spawnSync("open", isDir ? [target] : ["-R", target]);
  }
  return spawnSync("xdg-open", [isDir ? target : path.dirname(target)]);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function projectRoot() {
  return path.resolve(fileURLToPath(new URL("..", import.meta.url)));
}

export function resolveJob(jobArg) {
  const root = projectRoot();
  if (!jobArg) return path.join(root, "jobs", "current");
  return path.isAbsolute(jobArg) ? jobArg : path.join(root, jobArg);
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function ensureSymlink(target, linkPath) {
  try {
    fs.lstatSync(linkPath);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  // Windows 普通用户无 symlink 权限,用 junction;失败再回退到复制
  try {
    fs.symlinkSync(target, linkPath, isWindows ? "junction" : "dir");
  } catch (error) {
    if (!isWindows) throw error;
    copyDir(target, linkPath);
  }
}

export function readJsonArray(file) {
  if (!fs.existsSync(file)) return [];
  const data = readJson(file);
  if (!Array.isArray(data)) throw new Error(`${file} must contain a JSON array`);
  return data;
}

export function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    ...options
  });
  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr}` : "";
    throw new Error(`${command} ${args.join(" ")} failed${stderr}`);
  }
  return result;
}

export function commandOk(command, args = ["--version"]) {
  const result = spawnSync(command, args, { stdio: "pipe", encoding: "utf8" });
  return {
    ok: result.status === 0,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim()
  };
}

export function ffprobeJson(file) {
  const result = run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,duration,bit_rate",
      "-show_entries",
      "format=duration,size,bit_rate",
      "-of",
      "json",
      file
    ],
    { capture: true }
  );
  return JSON.parse(result.stdout);
}

export function videoDuration(file) {
  const probe = ffprobeJson(file);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const raw = Number(video?.duration || probe.format?.duration);
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error(`Cannot read video duration from ${file}`);
  }
  return raw;
}

export function sanitizeSlug(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function escapeHtml(input) {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function seconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid seconds value: ${value}`);
  return n;
}

export function fmtTime(value) {
  return seconds(value).toFixed(2);
}
