import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { inspectComponentCatalog, inspectComponentPackages, loadComponentCatalog } from "./component-registry.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("生产目录的十个组件均可加载并支持竖横屏", async () => {
  const catalog = await inspectComponentCatalog({ root: ROOT });
  assert.deepEqual(catalog.errors, []);
  assert.equal(catalog.components.length, 10);
  for (const component of catalog.components) {
    assert.deepEqual(component.formats, ["portrait", "landscape"]);
    assert.ok(component.fixtures.length > 0);
  }
});

test("新增第十一个组件只需新增组件目录", async (context) => {
  const root = makeRoot(context);
  copyComponent("statement", root, "eleventh-card");
  const catalog = await inspectComponentCatalog({ root });
  assert.deepEqual(catalog.errors, []);
  assert.deepEqual(catalog.components.map((item) => item.id), ["eleventh-card"]);
  const fixture = catalog.components[0].fixtures[0].beat;
  assert.equal(catalog.components[0].render(fixture).includes(fixture.title), true);
});

test("坏组件在生产加载时严格失败", async (context) => {
  const root = makeRoot(context);
  copyComponent("statement", root, "broken-card");
  fs.rmSync(path.join(root, "components", "broken-card", "style.css"));
  const inspected = inspectComponentPackages({ root });
  assert.equal(inspected.components.length, 0);
  assert.match(inspected.errors[0].message, /style\.css/);
  await assert.rejects(loadComponentCatalog({ root }), /组件目录校验失败/);
});

test("App、builder、任务卡和预览生成器不保留组件白名单", () => {
  const files = [
    "console/public/app.js",
    "scripts/build-beats-composition.mjs",
    "console/prompts.mjs",
    "scripts/visual-preview-generate.mjs"
  ].map((file) => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");
  assert.doesNotMatch(files, /BEAT_TYPES|currentComponents/);
  assert.match(files, /component-registry\.mjs|FactoryConsole\.setComponentCatalog/);
});

function makeRoot(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "factory-components-"));
  fs.mkdirSync(path.join(root, "components"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "scripts", "lib.mjs"), path.join(root, "scripts", "lib.mjs"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function copyComponent(sourceId, root, targetId) {
  const target = path.join(root, "components", targetId);
  fs.cpSync(path.join(ROOT, "components", sourceId), target, { recursive: true });
  const manifestFile = path.join(target, "component.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.id = targetId;
  manifest.label = "第十一个测试组件";
  manifest.apply.type = targetId;
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
}
