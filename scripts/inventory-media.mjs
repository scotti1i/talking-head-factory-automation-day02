import fs from "node:fs";
import path from "node:path";
import { ffprobeJson, parseArgs, resolveJob, writeJson } from "./lib.mjs";

const args = parseArgs();
const jobDir = resolveJob(args.job);
const sourceDir = path.resolve(jobDir, args.sourceDir || "assets/originals");
const output = path.resolve(jobDir, args.output || "data/source-inventory.json");

if (!fs.existsSync(sourceDir)) throw new Error(`素材目录不存在: ${sourceDir}`);

const items = fs
  .readdirSync(sourceDir)
  .filter((name) => /\.(mp4|mov|m4v)$/i.test(name))
  .sort()
  .map((name) => inspect(path.join(sourceDir, name)));

if (!items.length) throw new Error(`素材目录里没有视频: ${sourceDir}`);

writeJson(output, { generatedAt: new Date().toISOString(), sourceDir, items });
console.log(`素材清单: ${items.length} 条 → ${output}`);

function inspect(file) {
  const probe = ffprobeJson(file);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  return {
    file: path.basename(file),
    path: path.relative(jobDir, file).split(path.sep).join("/"),
    size: Number(probe.format?.size || fs.statSync(file).size),
    duration: Number(probe.format?.duration || video?.duration || 0),
    video: video
      ? { codec: video.codec_name, width: video.width, height: video.height, fps: video.avg_frame_rate || video.r_frame_rate }
      : null,
    audio: audio ? { codec: audio.codec_name, bitrate: Number(audio.bit_rate || 0) } : null
  };
}
