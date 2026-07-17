import fs from "node:fs";
import path from "node:path";
import { ffprobeJson, parseArgs, projectRoot, readJson, resolveJob, run, writeJson } from "./lib.mjs";

const args = parseArgs();
const jobDir = resolveJob(args.job);
const config = readJson(path.join(jobDir, "project.json"));
const videoPath = resolveVideoPath(args.video || path.join("renders", "final-60fps.mp4"));

if (!fs.existsSync(videoPath)) {
  console.error(`Missing final video: ${videoPath}`);
  process.exit(1);
}

function resolveVideoPath(input) {
  if (path.isAbsolute(input)) return input;
  const rootCandidate = path.join(projectRoot(), input);
  if (fs.existsSync(rootCandidate)) return rootCandidate;
  return path.join(jobDir, input);
}

const probe = ffprobeJson(videoPath);
const video = probe.streams.find((stream) => stream.codec_type === "video");
const audio = probe.streams.find((stream) => stream.codec_type === "audio");
const expectedWidth = Number(config.width || 1080);
const expectedHeight = Number(config.height || 1920);
const configuredFps = String(config.render?.fps || 60);
const expectedFps = String(args.fps || (configuredFps.includes("/") ? configuredFps : `${configuredFps}/1`));

const failures = [];
if (video.width !== expectedWidth) failures.push(`width ${video.width} != ${expectedWidth}`);
if (video.height !== expectedHeight) failures.push(`height ${video.height} != ${expectedHeight}`);
if (video.avg_frame_rate !== expectedFps && video.r_frame_rate !== expectedFps) {
  failures.push(`fps ${video.avg_frame_rate} / ${video.r_frame_rate} != ${expectedFps}`);
}
if (!audio) failures.push("missing audio stream");

const qaDir = path.join(jobDir, "qa", "final-frames");
fs.mkdirSync(qaDir, { recursive: true });
for (const name of fs.readdirSync(qaDir)) {
  if (/^frame-\d+ms\.jpg$/.test(name)) fs.unlinkSync(path.join(qaDir, name));
}

const chapterTimes = readTimes(path.join(jobDir, "data", "chapters.json"), "start").map((time) => time + 0.5);
const overlayTimes = readTimes(path.join(jobDir, "data", "overlays.json"), "start").map((time) => time + 0.5);
const beatTimes = readTimes(path.join(jobDir, "data", "beats.json"), "start").map((time) => time + 0.5);
const configured = Array.isArray(config.qa?.sampleTimes) ? config.qa.sampleTimes : [];
const duration = Number(video.duration || probe.format.duration || 0);
const sampleTimes = uniqueTimes([0.5, ...configured, ...chapterTimes, ...overlayTimes, ...beatTimes, Math.max(0.5, duration - 1)], duration);

for (const time of sampleTimes) {
  const out = path.join(qaDir, `frame-${String(Math.round(time * 1000)).padStart(6, "0")}ms.jpg`);
  run("ffmpeg", ["-y", "-ss", String(time), "-i", videoPath, "-frames:v", "1", "-q:v", "2", out], { capture: true });
}

const report = {
  status: "review_required",
  videoPath,
  checkedAt: new Date().toISOString(),
  streams: probe.streams,
  format: probe.format,
  sampleTimes,
  framesDir: qaDir,
  failures
};

writeJson(path.join(jobDir, "qa", "report.json"), report);
fs.writeFileSync(path.join(jobDir, "qa", "report.md"), renderMarkdown(report));

if (failures.length) {
  console.error(`QA failed: ${failures.join("; ")}`);
  process.exit(1);
}

console.log("规格 QA 通过；最终画面仍需逐帧检查和完整播放确认");
console.log(`Frames: ${qaDir}`);
console.log(`Report: ${path.join(jobDir, "qa", "report.md")}`);

function readTimes(file, key) {
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(data) ? data.map((item) => Number(item[key])).filter(Number.isFinite) : [];
}

function uniqueTimes(times, maxDuration) {
  const out = [];
  for (const raw of times) {
    const time = Number(raw);
    if (!Number.isFinite(time)) continue;
    const clamped = Math.max(0, Math.min(time, Math.max(0, maxDuration - 0.1)));
    if (!out.some((existing) => Math.abs(existing - clamped) < 0.25)) out.push(clamped);
  }
  return out.sort((a, b) => a - b);
}

function renderMarkdown(report) {
  const videoStream = report.streams.find((stream) => stream.codec_type === "video");
  const audioStream = report.streams.find((stream) => stream.codec_type === "audio");
  return `# Final QA Report

- Video: \`${report.videoPath}\`
- Checked: ${report.checkedAt}
- Resolution: ${videoStream.width}x${videoStream.height}
- FPS: ${videoStream.avg_frame_rate}
- Duration: ${report.format.duration}s
- Video bitrate: ${videoStream.bit_rate || "_"} 
- Audio: ${audioStream ? `${audioStream.codec_name} / ${audioStream.bit_rate || "_"} bps` : "missing"}
- Frames: \`${report.framesDir}\`
- Failures: ${report.failures.length ? report.failures.join("; ") : "none"}

## Sample Times

${report.sampleTimes.map((time) => `- ${time.toFixed(2)}s`).join("\n")}
`;
}
