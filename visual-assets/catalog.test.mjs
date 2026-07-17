import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { listVisualLibrary } from "../console/visual-library.mjs";

// 开源包只登记 clone 下来真实存在的东西：现役 beats-v2 家族 × 主题 × 组件。
// 历史成片包装档案（原绑定作者真实视频的 evidence 抽帧）已随脱敏移除，不再留空壳条目。
const EXPECTED_FAMILIES = ["beats-v2-face-safe"];

test("生产目录只登记当前生产视觉家族", () => {
  const library = listVisualLibrary();
  assert.deepEqual(library.families.map((family) => family.id).sort(), EXPECTED_FAMILIES);
  assert.equal(library.counts.families, 1);
  // 顶层资产只剩三类：生产家族(preset)、自动发现组件、随包主题。
  assert.deepEqual(new Set(library.assets.map((asset) => asset.kind)), new Set([
    "theme",
    "component",
    "preset"
  ]));
  const active = library.families.find((family) => family.id === "beats-v2-face-safe");
  assert.equal(active.lifecycle, "published");
  assert.equal(active.compatibility, "supported");
  assert.deepEqual(active.formats.map((format) => format.id), ["vertical", "horizontal"]);
});

test("生产家族与全部主题都解析到真实可看的合成预览", () => {
  const library = listVisualLibrary();
  const active = library.families.find((family) => family.id === "beats-v2-face-safe");
  assert.equal(active.preview.state, "ready", "beats-v2 family preview");
  assert.ok(active.preview.posterUrl, "beats-v2 family poster");

  assert.ok(library.themes.length >= 1, "至少注册一套主题");
  for (const theme of library.themes) {
    assert.equal(theme.preview.state, "ready", `${theme.id} theme preview`);
    assert.ok(theme.preview.posterUrl, `${theme.id} theme poster`);
  }
});

test("坏 family、component 和 theme manifest 仍返回为错误资产", (t) => {
  const root = fixtureRoot(t);
  write(root, "visual-assets/families/good.json", JSON.stringify(family("good")));
  write(root, "visual-assets/families/broken.json", "{ nope");
  write(root, "components/broken-component/component.json", "[broken");
  write(root, "themes/registry.json", JSON.stringify({ default: "broken-theme", themes: ["broken-theme"] }));
  write(root, "themes/broken-theme/theme.json", "{ broken");

  const library = listVisualLibrary({ root });
  assert.equal(library.families.length, 2);
  assert.equal(library.families.find((asset) => asset.id === "broken").health.state, "error");
  assert.equal(library.components.find((asset) => asset.id === "broken-component").health.state, "error");
  assert.equal(library.themes.find((asset) => asset.id === "broken-theme").health.state, "error");
  assert.ok(library.errors.some((error) => error.code === "manifest_invalid"));
});

test("预览 manifest 与 jobs beats 使用记录会合并到自动发现组件", (t) => {
  const root = fixtureRoot(t);
  write(root, "visual-assets/families/beats-v2-face-safe.json", JSON.stringify(family("beats-v2-face-safe")));
  write(root, "components/statement/component.json", JSON.stringify({
    schemaVersion: 1,
    id: "statement",
    label: "判断金句",
    kind: "component",
    category: "emphasis",
    description: "突出一句判断。",
    version: "1.0.0",
    lifecycle: "published",
    compatibility: "supported",
    formats: ["portrait", "landscape"],
    requiredFields: ["body", "accent"],
    optionalFields: [],
    tags: ["判断"],
    source: "fixture",
    apply: { mode: "beat", type: "statement" }
  }));
  write(root, "components/statement/render.mjs", "export function render() { return ''; }");
  write(root, "components/statement/style.css", ".beat-statement {}");
  write(root, "components/statement/fixtures.json", "[]");
  write(root, "themes/registry.json", JSON.stringify({ default: "test", themes: ["test"] }));
  write(root, "themes/test/theme.json", JSON.stringify({ id: "test", label: "Test", tokens: {} }));
  write(root, "jobs/demo/project.json", JSON.stringify({ title: "Demo", theme: "test", width: 1920, height: 1080 }));
  write(root, "jobs/demo/data/beats.json", JSON.stringify([{ type: "statement" }, { type: "statement" }]));
  write(root, "out/visual-library/cache/hash/index.html", "<main></main>");
  write(root, "out/visual-library/cache/hash/poster.webp", "poster");
  write(root, "out/visual-library/cache/hash/result.json", "{}");
  write(root, "out/visual-library/cache/last-good/index.html", "<main>last good</main>");
  write(root, "out/visual-library/cache/last-good/poster.webp", "last good poster");
  write(root, "out/visual-library/manifest.json", JSON.stringify({
    cells: {
      "statement/test/landscape": {
        component: "statement",
        theme: "test",
        format: "landscape",
        status: "ready",
        cachePath: "out/visual-library/cache/hash",
        posterPath: "out/visual-library/cache/hash/poster.webp",
        resultPath: "out/visual-library/cache/hash/result.json"
      },
      "statement/test/portrait": {
        component: "statement",
        theme: "test",
        format: "portrait",
        status: "failed",
        cachePath: "out/visual-library/cache/new-hash",
        resultPath: "out/visual-library/cache/new-hash/result.json",
        lastGoodHash: "last-good",
        error: { "message": "snapshot failed" }
      }
    }
  }));

  const component = listVisualLibrary({ root }).components.find((asset) => asset.id === "statement");
  assert.deepEqual(component.formats.map((format) => format.id), ["vertical", "horizontal"]);
  assert.equal(component.preview.state, "ready");
  assert.equal(component.preview.posterUrl, "/files/out/visual-library/cache/hash/poster.webp");
  assert.equal(component.preview.loopUrl, "/files/out/visual-library/cache/hash/index.html");
  assert.equal(component.health.state, "error");
  assert.equal(component.previews.find((preview) => preview.state === "failed").posterUrl, "/files/out/visual-library/cache/last-good/poster.webp");
  assert.equal(component.usage.count, 1);
  assert.equal(component.usage.beatCount, 2);
  assert.equal(component.apply.enabled, true);
});

function fixtureRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "visual-library-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function family(id) {
  return {
    schemaVersion: 1,
    id,
    label: id,
    kind: "preset",
    lifecycle: "published",
    compatibility: "supported",
    formats: ["vertical"],
    items: [{ id: "statement", label: "Statement", kind: "component" }],
    apply: { mode: "preset", payload: { preset: id } }
  };
}
