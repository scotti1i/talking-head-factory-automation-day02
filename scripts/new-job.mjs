import fs from "node:fs";
import path from "node:path";
import { copyDir, parseArgs, projectRoot, readJson, sanitizeSlug, writeJson } from "./lib.mjs";

const args = parseArgs();
const slug = sanitizeSlug(args._[0] || args.slug);

if (!slug) {
  console.error("Usage: npm run new -- <slug>");
  process.exit(1);
}

const root = projectRoot();
const templateDir = path.join(root, "templates", "job");
const jobDir = path.join(root, "jobs", slug);

if (fs.existsSync(jobDir)) {
  console.error(`Job already exists: ${jobDir}`);
  process.exit(1);
}

copyDir(templateDir, jobDir);

const configPath = path.join(jobDir, "project.json");
const config = readJson(configPath);
config.slug = slug;
config.title = args.title || slug;
config.downloadFolderName = args.folder || `${new Date().toISOString().slice(0, 10)}-${slug}-抖音成片`;
writeJson(configPath, config);

console.log(`Created job: ${jobDir}`);
console.log("Next:");
console.log(`  1. Put untouched recordings in ${path.join(jobDir, "assets", "originals")}`);
console.log(`  2. Run npm run inventory -- --job jobs/${slug}`);
console.log(`  3. Run npm run transcribe:editor -- --job jobs/${slug}`);
console.log(`  4. Review EDL/captions/beats, then run npm run build:beats -- --job jobs/${slug}`);
