import fs from "node:fs";
import path from "node:path";
import { parseArgs, readJson, resolveJob, writeJson } from "./lib.mjs";

const args = parseArgs();
const jobDir = resolveJob(args.job);
const qaDir = path.resolve(jobDir, args.qaDir || "qa/cuts");
const reportPath = path.join(qaDir, "report.json");
const reviewer = String(args.reviewer || "").trim();
if (!reviewer) throw new Error("必须提供 --reviewer；只有逐张看完切点图后才能批准");
if (!fs.existsSync(reportPath)) throw new Error(`缺少切点报告: ${reportPath}`);

const report = readJson(reportPath);
const missing = report.cuts.filter((cut) => !fs.existsSync(path.join(jobDir, cut.image)));
if (missing.length) throw new Error(`缺少 ${missing.length} 张切点图，不能批准`);

const approval = {
  status: "approved",
  reviewedAt: new Date().toISOString(),
  reviewer,
  cutCount: report.cuts.length,
  notes: String(args.notes || "逐张检查通过")
};
writeJson(path.join(qaDir, "approval.json"), approval);
console.log(`切点 QA 已批准: ${report.cuts.length} 个 · ${reviewer}`);
