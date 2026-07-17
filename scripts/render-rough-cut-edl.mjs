import fs from "node:fs";
import path from "node:path";
import { ffprobeJson, parseArgs, readJsonArray, resolveJob, run } from "./lib.mjs";

const args = parseArgs();
const jobDir = resolveJob(args.job);
const inputPath = path.resolve(jobDir, args.input || "data/rough-cut-edl.json");
const outputPath = path.resolve(jobDir, args.output || "assets/aroll.mp4");
const sourceKey = args.sourceKey || "source";
const crf = String(args.crf || 20);
const preset = args.preset || "veryfast";
const fps = Number(args.fps || 30);
const videoBitrate = args["video-bitrate"];

const segments = readJsonArray(inputPath);
if (!segments.length) throw new Error(`No segments in ${inputPath}`);

const firstSource = path.join(jobDir, segments[0]?.[sourceKey] || segments[0]?.source || "");
if (!fs.existsSync(firstSource)) throw new Error(`Missing first source: ${firstSource}`);
const firstVideo = ffprobeJson(firstSource).streams.find((stream) => stream.codec_type === "video");
const targetWidth = Number(args.width || firstVideo?.width);
const targetHeight = Number(args.height || firstVideo?.height);
if (!(targetWidth > 0 && targetHeight > 0)) throw new Error("Cannot determine rough-cut canvas size");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(path.join(jobDir, "tmp"), { recursive: true });

const inputs = [];
const filters = [];
const labels = [];

segments.forEach((segment, index) => {
  const source = segment[sourceKey] || segment.source;
  if (!source) throw new Error(`Segment ${index + 1} is missing ${sourceKey}/source`);
  const sourcePath = path.join(jobDir, source);
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing media: ${sourcePath}`);

  inputs.push("-i", sourcePath);
  const start = Number(segment.sourceStart).toFixed(3);
  const end = Number(segment.sourceEnd).toFixed(3);
  const duration = Number(segment.sourceEnd) - Number(segment.sourceStart);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Segment ${index + 1} has invalid range: ${segment.sourceStart} → ${segment.sourceEnd}`);
  }
  const fade = Math.min(0.03, duration / 4);
  const fadeOut = Math.max(0, duration - fade);
  filters.push(
    `[${index}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight},setsar=1,fps=${fps},format=yuv420p[v${index}]`
  );
  filters.push(
    `[${index}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:st=0:d=${fade.toFixed(3)},afade=t=out:st=${fadeOut.toFixed(3)}:d=${fade.toFixed(3)}[a${index}]`
  );
  labels.push(`[v${index}][a${index}]`);
});

filters.push(`${labels.join("")}concat=n=${segments.length}:v=1:a=1[outv][outa]`);

const filterPath = path.join(jobDir, "tmp", `${path.parse(outputPath).name}.ffmpeg`);
fs.writeFileSync(filterPath, filters.join(";\n"));

run("ffmpeg", [
  "-hide_banner",
  "-y",
  ...inputs,
  "-filter_complex_script",
  filterPath,
  "-map",
  "[outv]",
  "-map",
  "[outa]",
  "-c:v",
  "libx264",
  "-preset",
  preset,
  ...(videoBitrate ? ["-b:v", String(videoBitrate), "-maxrate", String(videoBitrate), "-bufsize", String(Number.parseInt(videoBitrate, 10) * 2 || 48) + "M"] : ["-crf", crf]),
  "-g",
  String(Math.round(fps)),
  "-keyint_min",
  String(Math.round(fps)),
  "-sc_threshold",
  "0",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-movflags",
  "+faststart",
  outputPath
]);

console.log(`Rendered ${outputPath} · ${targetWidth}x${targetHeight}`);
