import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  buildBrandPromptBlock,
  countLampWordHits,
  getBrandKit,
  listBrandKits,
  parseBrandKit,
  renderBrandKitMarkdown,
  resolveBrandKit,
  validateBrandKit,
  type BrandKit,
} from "../../lib/brand-kit";

const KIT_DIR = path.join(process.cwd(), "brand-kits");

const SAMPLE: BrandKit = {
  slug: "sample",
  name: "Sample Brand",
  version: "1.2.3",
  locale: "us-eu",
  mood: ["calm", "editorial"],
  materials: ["honed travertine", "ivory linen"],
  palette: { base: ["ivory"], accent: ["antique brass"], avoid: ["neon"] },
  lighting: ["soft morning daylight from one tall window"],
  composition: ["wide editorial interior photograph"],
  styling: ["one ceramic vessel"],
  negative: ["visible logos", "text overlays"],
  notes: "人工说明，不注入 prompt。",
};

test("仓库自带的品牌档案都能解析，且注入段落不含灯具词", async () => {
  const { kits, problems } = await listBrandKits(KIT_DIR);
  assert.deepEqual(problems, []);
  assert.ok(kits.length >= 3, `期望至少 3 份品牌档案，实际 ${kits.length}`);

  for (const kit of kits) {
    assert.deepEqual(validateBrandKit(kit), [], `${kit.slug} 校验未通过`);
    for (const mode of ["text", "room-first"] as const) {
      const block = buildBrandPromptBlock(kit, mode);
      assert.equal(
        countLampWordHits(block),
        0,
        `${kit.slug} 的 ${mode} 段落里出现了灯具词，会让 planner 自检失败`,
      );
      assert.ok(block.includes(kit.name), `${kit.slug} 段落应包含品牌名`);
      assert.ok(block.includes(`v${kit.version}`), `${kit.slug} 段落应包含版本`);
    }
  }
});

test("DESIGN.md 往返：render → parse 保持等价", () => {
  const roundTripped = parseBrandKit(renderBrandKitMarkdown(SAMPLE), "sample");
  assert.deepEqual(roundTripped, SAMPLE);
});

test("palette 三档能正确拆分", () => {
  const md = [
    "---",
    "slug: p",
    "name: P",
    "---",
    "## Mood",
    "- calm",
    "## Materials",
    "- oak",
    "## Palette",
    "- base: ivory, limestone",
    "- accent: brass",
    "- avoid: neon, pure black",
  ].join("\n");
  const kit = parseBrandKit(md);
  assert.deepEqual(kit.palette.base, ["ivory", "limestone"]);
  assert.deepEqual(kit.palette.accent, ["brass"]);
  assert.deepEqual(kit.palette.avoid, ["neon", "pure black"]);
});

test("中文章节名与 Notes 段都被识别", () => {
  const md = [
    "---",
    "slug: zh",
    "name: 中文品牌",
    "---",
    "## 调性",
    "- 安静",
    "## 材质",
    "- 洞石",
    "## 配色",
    "- base: 米白",
    "## 禁止",
    "- 文字水印",
    "## 备注",
    "这段只给人看，不进 prompt。",
  ].join("\n");
  const kit = parseBrandKit(md);
  assert.deepEqual(kit.mood, ["安静"]);
  assert.deepEqual(kit.materials, ["洞石"]);
  assert.deepEqual(kit.palette.base, ["米白"]);
  assert.deepEqual(kit.negative, ["文字水印"]);
  assert.equal(kit.notes, "这段只给人看，不进 prompt。");
  assert.equal(buildBrandPromptBlock(kit).includes("只给人看"), false);
});

test("非法输入被拒绝：slug、版本、缺失必填项、灯具词泄漏", () => {
  assert.throws(() => parseBrandKit("---\nslug: Bad Slug\nname: X\n---"), /brand_kit_bad_slug/);
  assert.throws(() => parseBrandKit("---\nslug: ok\nname: X\nversion: v1\n---"), /brand_kit_bad_version/);
  assert.throws(
    () => parseBrandKit("---\nslug: ok\nname: X\n---\n## Materials\n- oak\n"),
    /brand_kit_invalid/,
  );
  // 灯具词泄漏：mood 里写了 lamp，注入段落会带出灯具词 → 必须被拒
  assert.throws(
    () =>
      parseBrandKit(
        "---\nslug: ok\nname: X\n---\n## Mood\n- a quiet lamp corner\n## Materials\n- oak\n",
      ),
    /brand_kit_invalid/,
  );
});

test("room-first 段落声明「锁定房间优先」，text 段落声明「品牌不治理产品」", () => {
  const text = buildBrandPromptBlock(SAMPLE, "text");
  const roomFirst = buildBrandPromptBlock(SAMPLE, "room-first");
  assert.match(text, /never the product/);
  assert.match(roomFirst, /locked room wins/);
  assert.notEqual(text, roomFirst);
});

test("读不到的 slug 返回 null，resolveBrandKit 降级而不抛错", async () => {
  assert.equal(await getBrandKit("definitely-not-here", KIT_DIR), null);

  const missing = await resolveBrandKit("definitely-not-here");
  assert.equal(missing.kit, null);
  assert.equal(missing.block, null);
  assert.match(missing.reason, /brand_kit_not_found/);

  const ok = await resolveBrandKit("quiet-luxury");
  assert.ok(ok.kit);
  assert.equal(ok.reason, "ok");
});

test("countLampWordHits 对重叠命中只算一次", () => {
  assert.equal(countLampWordHits("a pendant light above the table"), 1);
  // "lighting fixture" 里已经含 "fixture"，重叠部分只算一次
  assert.equal(countLampWordHits("the lighting fixture"), 1);
  assert.equal(countLampWordHits("no words of that kind here at all"), 0);
  assert.equal(countLampWordHits("a chandelier beside a wall sconce"), 2);
});
