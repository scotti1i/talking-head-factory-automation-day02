import fs from "node:fs";
import path from "node:path";
import { parseArgs, readJsonArray, resolveJob } from "./lib.mjs";

const args = parseArgs();
const jobDir = resolveJob(args.job);
const checks = [
  check("原片", mediaCount("assets/originals") > 0, `${mediaCount("assets/originals")} 条`),
  fileCheck("素材清单", "data/source-inventory.json"),
  fileCheck("词级转录索引", "data/transcripts/index.json"),
  fileCheck("编辑转录", "data/takes-packed.md"),
  arrayCheck("语义 EDL", "data/rough-cut-edl.json"),
  fileCheck("粗剪母版", "assets/aroll.mp4"),
  fileCheck("切点证据", "qa/cuts/report.json"),
  fileCheck("切点批准", "qa/cuts/approval.json"),
  arrayCheck("最终字幕", "data/captions.json"),
  arrayCheck("解释卡片", "data/beats.json"),
  optionalArray("B-roll", "data/broll.json"),
  fileCheck("主合成", "index.html"),
  check("variants", variantCount() > 0, `${variantCount()} 个`),
  check("最终规格 QA", finalQaCount() >= expectedFinalCount(), `${finalQaCount()}/${expectedFinalCount()} 份`),
  check("最终画面批准", finalApprovalCount() >= expectedFinalCount(), `${finalApprovalCount()}/${expectedFinalCount()} 份`),
  check("最终完整播放", publishReadyCount() >= expectedFinalCount(), `${publishReadyCount()}/${expectedFinalCount()} 份`)
];

const ready = checks.every((item) => item.optional || item.ok);
if (args.json) {
  console.log(JSON.stringify({ job: jobDir, ready, checks }, null, 2));
} else {
  console.log(`\n口播工厂状态 · ${path.basename(jobDir)}\n`);
  for (const item of checks) console.log(`${item.ok ? "✓" : item.optional ? "·" : "✗"} ${item.name}${item.detail ? ` · ${item.detail}` : ""}`);
  console.log(`\n${ready ? "确定性工序已齐全" : "仍有必需工序未完成"}`);
}
if (!ready && args.strict) process.exit(1);

function fileCheck(name, relative) {
  return check(name, fs.existsSync(path.join(jobDir, relative)), relative);
}

function arrayCheck(name, relative) {
  const file = path.join(jobDir, relative);
  const count = fs.existsSync(file) ? readJsonArray(file).length : 0;
  return check(name, count > 0, `${count} 条`);
}

function optionalArray(name, relative) {
  const file = path.join(jobDir, relative);
  const count = fs.existsSync(file) ? readJsonArray(file).length : 0;
  return { ...check(name, true, `${count} 条`), optional: true };
}

function mediaCount(relative) {
  const dir = path.join(jobDir, relative);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => /\.(mp4|mov|m4v)$/i.test(file)).length : 0;
}

function variantCount() {
  const dir = path.join(jobDir, "variants");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => fs.existsSync(path.join(dir, name, "index.html"))).length : 0;
}

function finalQaCount() {
  let count = fs.existsSync(path.join(jobDir, "qa", "report.json")) ? 1 : 0;
  const variantsDir = path.join(jobDir, "variants");
  if (!fs.existsSync(variantsDir)) return count;
  for (const name of fs.readdirSync(variantsDir)) {
    if (fs.existsSync(path.join(variantsDir, name, "qa", "report.json"))) count += 1;
  }
  return count;
}

function finalApprovalCount() {
  let count = fs.existsSync(path.join(jobDir, "qa", "approval.json")) ? 1 : 0;
  const variantsDir = path.join(jobDir, "variants");
  if (!fs.existsSync(variantsDir)) return count;
  for (const name of fs.readdirSync(variantsDir)) {
    if (fs.existsSync(path.join(variantsDir, name, "qa", "approval.json"))) count += 1;
  }
  return count;
}

function publishReadyCount() {
  return approvalFiles().filter((file) => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")).status === "publish_ready";
    } catch {
      return false;
    }
  }).length;
}

function approvalFiles() {
  const files = [];
  const rootApproval = path.join(jobDir, "qa", "approval.json");
  if (fs.existsSync(rootApproval)) files.push(rootApproval);
  const variantsDir = path.join(jobDir, "variants");
  if (!fs.existsSync(variantsDir)) return files;
  for (const name of fs.readdirSync(variantsDir)) {
    const file = path.join(variantsDir, name, "qa", "approval.json");
    if (fs.existsSync(file)) files.push(file);
  }
  return files;
}

function expectedFinalCount() {
  return Math.max(1, variantCount());
}

function check(name, ok, detail) {
  return { name, ok: Boolean(ok), detail };
}
