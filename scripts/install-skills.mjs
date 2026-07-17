#!/usr/bin/env node
// ============================================================
// install-skills.mjs
// 把本仓库的 skills/talkinghead-edit 安装到 Claude Code 和/或
// Codex 的 skills 目录。检测到同名已存在 → 跳过，绝不覆盖。
//
//   node scripts/install-skills.mjs              # 安装
//   node scripts/install-skills.mjs --uninstall  # 卸载
//
// 跨平台：posix 用软链，Windows 用递归拷贝。
// ============================================================

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import os from "node:os";
import fs from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const skillName = "talkinghead-edit";
const source = join(repoRoot, "skills", skillName);
const isWindows = process.platform === "win32";
const uninstall = process.argv.slice(2).includes("--uninstall");

// 两家 CLI 的宿主目录：只有宿主根目录存在才认为该 CLI 已装。
const hosts = [
  { label: "Claude Code", root: join(os.homedir(), ".claude") },
  { label: "Codex", root: join(os.homedir(), ".codex") },
];

// ---------- 工具 ----------

function lstatSafe(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

// 拷贝安装的目录里放个记号，卸载时凭它判断是不是本脚本装的。
const MARKER = ".installed-by-talkinghead";

function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true });
  fs.writeFileSync(join(to, MARKER), "talkinghead-edit install-skills.mjs\n");
}

function installOne(host) {
  const skillsDir = join(host.root, "skills");
  const target = join(skillsDir, skillName);

  const st = lstatSafe(target);
  if (st) {
    // 已存在（软链或目录）→ 尊重用户现有安装，跳过。
    console.log(`  ↳ ${host.label}: 已存在 ${target}，跳过（不覆盖）`);
    return;
  }

  fs.mkdirSync(skillsDir, { recursive: true });

  if (isWindows) {
    copyDir(source, target);
    console.log(`  ✓ ${host.label}: 已拷贝 → ${target}`);
  } else {
    fs.symlinkSync(source, target);
    console.log(`  ✓ ${host.label}: 已软链 → ${target}`);
  }
}

function uninstallOne(host) {
  const target = join(host.root, "skills", skillName);
  const st = lstatSafe(target);
  if (!st) {
    console.log(`  ↳ ${host.label}: 未安装，跳过`);
    return;
  }

  if (st.isSymbolicLink()) {
    // 只移除指向本仓库的软链，别动用户指向别处的安装。
    let points = null;
    try {
      points = fs.realpathSync(target);
    } catch {}
    if (points === fs.realpathSync(source)) {
      fs.unlinkSync(target);
      console.log(`  ✓ ${host.label}: 已移除软链 ${target}`);
    } else {
      console.log(`  ↳ ${host.label}: ${target} 指向别处，保留不动`);
    }
    return;
  }

  // 目录：只移除本脚本拷贝安装的（带记号），否则保留。
  if (fs.existsSync(join(target, MARKER))) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`  ✓ ${host.label}: 已移除拷贝 ${target}`);
  } else {
    console.log(`  ↳ ${host.label}: ${target} 非本脚本安装，保留不动`);
  }
}

// ---------- 主流程 ----------

if (!fs.existsSync(source)) {
  console.error(`找不到 skill 源目录：${source}`);
  console.error("请在仓库根目录运行本脚本。");
  process.exit(1);
}

const present = hosts.filter((h) => fs.existsSync(h.root));

if (present.length === 0) {
  console.error("没检测到 Claude Code（~/.claude）或 Codex（~/.codex）。");
  console.error("请先安装其中之一，再运行本脚本：");
  console.error("  Claude Code → https://claude.com/claude-code");
  console.error("  Codex      → https://developers.openai.com/codex");
  process.exit(1);
}

if (uninstall) {
  console.log("卸载 talkinghead-edit skill：");
  for (const h of present) uninstallOne(h);
  console.log("完成。");
  process.exit(0);
}

console.log("安装 talkinghead-edit skill：");
for (const h of present) installOne(h);

console.log("");
console.log("装好了。在对应 CLI 里这样唤醒（两家用同一句）：");
console.log("  「用 talkinghead-edit 把这个口播原片做成竖屏和横屏成片」");
console.log("");
console.log(`提示：把仓库路径设进环境变量，skill 每次都能找到它：`);
console.log(`  export TALKINGHEAD_FACTORY="${repoRoot}"`);
