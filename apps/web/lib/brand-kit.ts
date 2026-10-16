/**
 * Brand Kit — 品牌设计体系（DESIGN.md）
 *
 * 灵感来源：nexu-io/open-design（Apache-2.0）的 design-systems 平面——以一份
 * DESIGN.md 为中心、可版本化、可校验的品牌包。本文件是按 Apache-2.0 允许的方式
 * **独立重写**的实现，未复制其源码；来源与授权记录见仓库根 THIRD_PARTY_NOTICES.md。
 *
 * 解决什么问题：
 *   现在"这张图长什么样"散落在 prompt-planner 的 system prompt、generation.ts 的
 *   AUDIENCE_KEYWORDS 和一堆形容词里。同一个商家出 10 张图，风格会飘。
 *   品牌档案把这件事收敛成一份人可读、机可校验、可版本化的文件：
 *   一个商家（或一个 SKU 线）对应一份 brand-kits/<slug>.md。
 *
 * 核心边界（重要，不要违反）：
 *   品牌只治理"环境"——房间、家具、材质、配色、光线、软装、构图；
 *   **品牌绝不治理产品本身**。产品的形状/材质/颜色始终来自参考图。
 *   这条边界保证注入品牌后不会把灯改成别的样子。
 *
 * 另一条硬约束：注入的 prompt block 里不能出现 lamp / pendant / fixture 等词。
 *   因为 prompt-planner 有一条强制自检——"灯具词在整个 prompt 里只能出现一次，
 *   且必须在最后一句"。品牌段落是环境描述，一旦带灯具词就会直接让 shot 被拒。
 *   buildBrandPromptBlock 会做这个自检，countLampWordHits 导出供测试复用。
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

/** 品牌档案目录。默认 apps/web/brand-kits，可用 BRAND_KIT_DIR 覆盖。 */
export const BRAND_KIT_DIR_ENV = "BRAND_KIT_DIR";
/** 未显式指定品牌时使用的默认 slug，可用 DEFAULT_BRAND_KIT 覆盖。 */
export const DEFAULT_BRAND_KIT_ENV = "DEFAULT_BRAND_KIT";

/** 目标市场。影响软装文化符码与色彩偏好，不改变产品。 */
export type BrandLocale = "cn" | "us-eu" | "jp" | "global";

export const BRAND_LOCALES: readonly BrandLocale[] = ["cn", "us-eu", "jp", "global"];

export type BrandPalette = {
  /** 主色/背景基调。 */
  base: string[];
  /** 点缀色。 */
  accent: string[];
  /** 明确回避的颜色。 */
  avoid: string[];
};

export type BrandKit = {
  slug: string;
  name: string;
  version: string;
  locale: BrandLocale;
  mood: string[];
  materials: string[];
  palette: BrandPalette;
  lighting: string[];
  composition: string[];
  styling: string[];
  negative: string[];
  notes: string;
};

export class BrandKitError extends Error {
  constructor(public code: string, message?: string) {
    // 消息里带上 code，日志里可以直接 grep，测试也能按 code 断言。
    super(message ? `${code}: ${message}` : code);
    this.name = "BrandKitError";
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** 与 prompt-planner 的 LAMP_WORDS 对齐：品牌段落不得出现这些词。 */
const LAMP_WORDS = [
  "lighting fixture",
  "light fixture",
  "pendant",
  "fixture",
  "lamp",
  "chandelier",
  "luminaire",
  "sconce",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 统计一段文本里出现了几个"灯具词"。重叠命中只算一次。
 * 与 prompt-planner 内部实现同语义，导出是为了让品牌段落也能被同一条规则约束。
 */
export function countLampWordHits(text: string): number {
  const hits: Array<{ start: number; end: number }> = [];
  for (const lw of LAMP_WORDS) {
    const re = new RegExp(`\\b${escapeRegExp(lw).replace(/\\s\+/g, "\\s+")}\\b`, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      hits.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const accepted: Array<{ start: number; end: number }> = [];
  for (const hit of hits) {
    if (accepted.some((e) => hit.start < e.end && hit.end > e.start)) continue;
    accepted.push(hit);
  }
  return accepted.length;
}

/* ------------------------------------------------------------------ *
 * 解析：DESIGN.md → BrandKit
 * ------------------------------------------------------------------ */

/** 把 "a, b, c" / "a；b" 拆成去重后的非空数组。 */
function splitList(raw: string): string[] {
  return raw
    .split(/[,，;；|]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

type SectionName =
  | "mood"
  | "materials"
  | "lighting"
  | "composition"
  | "styling"
  | "negative"
  | "palette"
  | "notes";

const SECTION_ALIASES: Record<string, SectionName> = {
  mood: "mood",
  tone: "mood",
  调性: "mood",
  materials: "materials",
  material: "materials",
  材质: "materials",
  lighting: "lighting",
  light: "lighting",
  光线: "lighting",
  composition: "composition",
  构图: "composition",
  styling: "styling",
  props: "styling",
  软装: "styling",
  never: "negative",
  negative: "negative",
  avoid: "negative",
  禁止: "negative",
  palette: "palette",
  colors: "palette",
  colours: "palette",
  配色: "palette",
  notes: "notes",
  note: "notes",
  说明: "notes",
  备注: "notes",
};

/** 从 front matter 行里取出 key/value。 */
function parseFrontMatterLine(line: string): [string, string] | null {
  const idx = line.indexOf(":");
  if (idx <= 0) return null;
  const key = line.slice(0, idx).trim().toLowerCase();
  let value = line.slice(idx + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

/**
 * 解析一份 DESIGN.md。
 *
 * 格式（front matter 必填 slug/name，其余章节都可选但建议写全）：
 *
 *   ---
 *   slug: quiet-luxury
 *   name: Quiet Luxury
 *   version: 1.0.0
 *   locale: us-eu
 *   ---
 *
 *   ## Mood
 *   - quiet luxury
 *
 *   ## Palette
 *   - base: ivory, limestone, warm greige
 *   - accent: antique brass
 *   - avoid: neon, saturated primaries
 *
 * 刻意不引 yaml 依赖：格式足够简单，手写解析更可控。
 */
export function parseBrandKit(markdown: string, fallbackSlug?: string): BrandKit {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  const meta: Record<string, string> = {};
  let cursor = 0;
  if (lines[0]?.trim() === "---") {
    cursor = 1;
    for (; cursor < lines.length; cursor++) {
      if (lines[cursor].trim() === "---") {
        cursor++;
        break;
      }
      const parsed = parseFrontMatterLine(lines[cursor]);
      if (parsed) meta[parsed[0]] = parsed[1];
    }
  }

  const sections: Record<SectionName, string[]> = {
    mood: [],
    materials: [],
    lighting: [],
    composition: [],
    styling: [],
    negative: [],
    palette: [],
    notes: [],
  };

  let current: SectionName | null = null;

  for (; cursor < lines.length; cursor++) {
    const raw = lines[cursor];
    const heading = raw.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      const key = heading[1].trim().toLowerCase();
      current = SECTION_ALIASES[key] ?? null;
      if (!current) sections.notes.push(heading[1].trim());
      continue;
    }
    const bullet = raw.match(/^\s*[-*+]\s+(.*)$/);
    if (current && bullet) {
      const value = bullet[1].trim();
      if (value) sections[current].push(value);
      continue;
    }
    if (current && raw.trim()) {
      // 章节里的非列表行也收进来（容忍作者写成段落）
      sections[current].push(raw.trim());
    }
  }

  const slug = (meta.slug || fallbackSlug || "").trim();
  if (!SLUG_RE.test(slug)) {
    throw new BrandKitError("brand_kit_bad_slug", `slug 不合法：${slug || "(空)"}`);
  }
  const name = (meta.name || slug).trim();
  const version = (meta.version || "1.0.0").trim();
  if (!VERSION_RE.test(version)) {
    throw new BrandKitError("brand_kit_bad_version", `version 需为 x.y.z：${version}`);
  }
  const localeRaw = (meta.locale || "global").trim().toLowerCase();
  const locale = (BRAND_LOCALES as readonly string[]).includes(localeRaw)
    ? (localeRaw as BrandLocale)
    : "global";

  const palette: BrandPalette = { base: [], accent: [], avoid: [] };
  for (const entry of sections.palette) {
    const [key, value] = [entry.slice(0, entry.indexOf(":")), entry.slice(entry.indexOf(":") + 1)];
    const normalized = entry.includes(":") ? key.trim().toLowerCase() : "";
    const values = splitList(entry.includes(":") ? value : entry);
    if (normalized === "base" || normalized === "主色") palette.base.push(...values);
    else if (normalized === "accent" || normalized === "点缀") palette.accent.push(...values);
    else if (normalized === "avoid" || normalized === "禁用") palette.avoid.push(...values);
    else palette.base.push(...values);
  }

  const kit: BrandKit = {
    slug,
    name,
    version,
    locale,
    mood: sections.mood,
    materials: sections.materials,
    palette,
    lighting: sections.lighting,
    composition: sections.composition,
    styling: sections.styling,
    negative: sections.negative,
    notes: sections.notes.join("\n").trim(),
  };

  const issues = validateBrandKit(kit);
  if (issues.length > 0) {
    throw new BrandKitError("brand_kit_invalid", issues.join("; "));
  }
  return kit;
}

/** 返回问题清单；空数组 = 合法。 */
export function validateBrandKit(kit: BrandKit): string[] {
  const issues: string[] = [];
  if (!SLUG_RE.test(kit.slug)) issues.push(`slug 不合法：${kit.slug}`);
  if (!kit.name.trim()) issues.push("name 不能为空");
  if (!VERSION_RE.test(kit.version)) issues.push(`version 需为 x.y.z：${kit.version}`);
  if (!(BRAND_LOCALES as readonly string[]).includes(kit.locale)) {
    issues.push(`locale 不合法：${kit.locale}`);
  }
  if (kit.mood.length === 0) issues.push("mood 至少一条");
  if (kit.materials.length === 0) issues.push("materials 至少一条");
  try {
    const block = buildBrandPromptBlock(kit, "text");
    const lampHits = countLampWordHits(block);
    if (lampHits > 0) {
      issues.push(
        `品牌段落里出现了 ${lampHits} 个灯具词，会让 planner 的"灯具词只出现一次"自检失败`,
      );
    }
  } catch (error) {
    issues.push(String((error as Error).message ?? error));
  }
  return issues;
}

/* ------------------------------------------------------------------ *
 * 序列化：BrandKit → DESIGN.md（可回写，保证 round-trip）
 * ------------------------------------------------------------------ */

function renderSection(title: string, items: string[]): string {
  if (items.length === 0) return "";
  return [`## ${title}`, ...items.map((x) => `- ${x}`), ""].join("\n");
}

export function renderBrandKitMarkdown(kit: BrandKit): string {
  const parts: string[] = [
    "---",
    `slug: ${kit.slug}`,
    `name: ${kit.name}`,
    `version: ${kit.version}`,
    `locale: ${kit.locale}`,
    "---",
    "",
  ];
  parts.push(renderSection("Mood", kit.mood));
  parts.push(renderSection("Materials", kit.materials));
  const paletteLines = [
    kit.palette.base.length > 0 ? `- base: ${kit.palette.base.join(", ")}` : "",
    kit.palette.accent.length > 0 ? `- accent: ${kit.palette.accent.join(", ")}` : "",
    kit.palette.avoid.length > 0 ? `- avoid: ${kit.palette.avoid.join(", ")}` : "",
  ].filter(Boolean);
  if (paletteLines.length > 0) {
    parts.push(["## Palette", ...paletteLines, ""].join("\n"));
  }
  parts.push(renderSection("Lighting", kit.lighting));
  parts.push(renderSection("Composition", kit.composition));
  parts.push(renderSection("Styling", kit.styling));
  parts.push(renderSection("Never", kit.negative));
  // Notes 必须写成显式章节，否则自由文本会被上一节吞掉（往返就不等价了）。
  if (kit.notes) parts.push(renderSection("Notes", kit.notes.split("\n").filter(Boolean)));
  return parts.filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** 内容指纹，用于把"这次出图吃的是哪一版品牌"记进任务日志。 */
export function brandKitSignature(kit: BrandKit): string {
  const normalized: BrandKit = {
    ...kit,
    mood: [...kit.mood].sort(),
    materials: [...kit.materials].sort(),
    lighting: [...kit.lighting].sort(),
    composition: [...kit.composition].sort(),
    styling: [...kit.styling].sort(),
    negative: [...kit.negative].sort(),
    palette: {
      base: [...kit.palette.base].sort(),
      accent: [...kit.palette.accent].sort(),
      avoid: [...kit.palette.avoid].sort(),
    },
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/* ------------------------------------------------------------------ *
 * 注入：BrandKit → prompt 段落
 * ------------------------------------------------------------------ */

export type BrandPromptMode = "text" | "room-first";

/**
 * 生成要注入 prompt 的英文段落。
 *
 * mode:
 *   - "text"       纯文字出图（planner / buildShotPrompt）。品牌全面治理环境。
 *   - "room-first" 房间参考图已锁定的双图法。房间本身不能改，
 *                  所以品牌只治理"新加进去的东西"和"重新打的光"。
 */
export function buildBrandPromptBlock(kit: BrandKit, mode: BrandPromptMode = "text"): string {
  const palette: string[] = [];
  if (kit.palette.base.length > 0) palette.push(`base ${kit.palette.base.join(" / ")}`);
  if (kit.palette.accent.length > 0) palette.push(`accents ${kit.palette.accent.join(" / ")}`);
  if (kit.palette.avoid.length > 0) palette.push(`avoid ${kit.palette.avoid.join(" / ")}`);

  const scope =
    mode === "room-first"
      ? "Where this brand guidance conflicts with the locked room reference, the locked room wins. Apply the brand only to what is newly added and to the relighting."
      : "Apply this brand's visual language to the room, its architecture, furniture, materials, textiles, colour balance, daylight and styling. The brand governs the SETTING, never the product.";

  const lines = [
    `BRAND DESIGN SYSTEM — "${kit.name}" (v${kit.version}, market: ${kit.locale})`,
    scope,
    "",
    `- Mood: ${kit.mood.join(", ")}`,
    `- Materials: ${kit.materials.join(", ")}`,
  ];
  if (palette.length > 0) lines.push(`- Colour palette: ${palette.join("; ")}`);
  if (kit.lighting.length > 0) lines.push(`- Light: ${kit.lighting.join(", ")}`);
  if (kit.composition.length > 0) lines.push(`- Composition: ${kit.composition.join(", ")}`);
  if (kit.styling.length > 0) lines.push(`- Styling and props: ${kit.styling.join(", ")}`);
  if (kit.negative.length > 0) lines.push(`- Never include: ${kit.negative.join(", ")}`);

  const block = lines.join("\n").trim();
  const lampHits = countLampWordHits(block);
  if (lampHits > 0) {
    throw new BrandKitError(
      "brand_kit_lamp_word_leak",
      `品牌段落里出现了 ${lampHits} 个灯具词，会让 planner 自检失败`,
    );
  }
  return block;
}

/* ------------------------------------------------------------------ *
 * 加载：磁盘上的 brand-kits/*.md
 * ------------------------------------------------------------------ */

type CacheEntry = { mtimeMs: number; kit: BrandKit };
const cache = new Map<string, CacheEntry>();

export function brandKitDir(): string {
  const override = process.env[BRAND_KIT_DIR_ENV]?.trim();
  if (override) return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  return path.join(process.cwd(), "brand-kits");
}

function resolveKitPath(slug: string, dir?: string): string {
  if (!SLUG_RE.test(slug)) throw new BrandKitError("brand_kit_bad_slug", `slug 不合法：${slug}`);
  return path.join(dir ?? brandKitDir(), `${slug}.md`);
}

/** 读单个品牌档案。文件不存在返回 null（调用方决定是否回退），格式错误则抛错。 */
export async function getBrandKit(slug: string, dir?: string): Promise<BrandKit | null> {
  const file = resolveKitPath(slug, dir);
  let mtimeMs: number;
  let raw: string;
  try {
    const info = await stat(file);
    mtimeMs = info.mtimeMs;
    const cached = cache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.kit;
    raw = await readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
  const kit = parseBrandKit(raw, slug);
  cache.set(file, { mtimeMs, kit });
  return kit;
}

/** 列出目录下所有品牌档案。单个文件损坏不会中断整体，问题进 problems。 */
export async function listBrandKits(
  dir?: string,
): Promise<{ kits: BrandKit[]; problems: Array<{ file: string; error: string }> }> {
  const target = dir ?? brandKitDir();
  let entries: string[];
  try {
    entries = await readdir(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { kits: [], problems: [] };
    throw error;
  }
  const kits: BrandKit[] = [];
  const problems: Array<{ file: string; error: string }> = [];
  for (const entry of entries.filter((f) => f.endsWith(".md")).sort()) {
    const slug = entry.replace(/\.md$/, "");
    try {
      const kit = await getBrandKit(slug, target);
      if (kit) kits.push(kit);
    } catch (error) {
      problems.push({ file: entry, error: String((error as Error).message ?? error) });
    }
  }
  return { kits, problems };
}

/**
 * 决定这次出图用哪份品牌档案。
 *
 * 优先级：显式传入的 slug > DEFAULT_BRAND_KIT 环境变量 > 无品牌。
 * 读不到或解析失败时**不抛错**——出图链路不能因为品牌档案坏掉就整个失败，
 * 降级为"无品牌"并返回原因，由调用方决定是否记日志。
 */
export async function resolveBrandKit(
  explicitSlug?: string | null,
): Promise<{ kit: BrandKit | null; block: string | null; reason: string }> {
  const slug = (explicitSlug ?? process.env[DEFAULT_BRAND_KIT_ENV] ?? "").trim();
  if (!slug) return { kit: null, block: null, reason: "no_brand_kit" };
  try {
    const kit = await getBrandKit(slug);
    if (!kit) return { kit: null, block: null, reason: `brand_kit_not_found:${slug}` };
    return { kit, block: buildBrandPromptBlock(kit, "text"), reason: "ok" };
  } catch (error) {
    return { kit: null, block: null, reason: `brand_kit_error:${String((error as Error).message)}` };
  }
}
