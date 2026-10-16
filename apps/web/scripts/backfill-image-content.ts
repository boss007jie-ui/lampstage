/** Explicit read-only dry run by default. Run during an idle upload boundary before enabling this release. */
import { prisma } from "../lib/db";
import { createHash } from "node:crypto";
import { ImageContentError, MAX_IMAGE_BYTES, registerExistingImage } from "../lib/assets/image-content";
async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !["--apply", "--dry-run"].includes(a)) || (args.includes("--apply") && args.includes("--dry-run")))
    throw new Error("Use --dry-run (default) or --apply");
  const apply = args.includes("--apply");
  let cursor: { id: string; created_at: Date } | null = null;
  const started = Date.now();
  let scanned = 0, registered = 0, failed = 0, newLinks = 0, bytesRead = 0; const hashes = new Set<string>();
  const failures: Record<string, number> = {}; const reportHash = createHash("sha256");
  const beforeContents = await prisma.imageContent.count();
  for (;;) {
    const rows: Array<{ id: string; user_id: string; created_at: Date; image_content_id: string | null }> = await prisma.uploadedAsset.findMany({ where: cursor ? { OR: [{ created_at: { gt: cursor.created_at } }, { created_at: cursor.created_at, id: { gt: cursor.id } }] } : {},
      orderBy: [{ created_at: "asc" }, { id: "asc" }], take: 100, select: { id: true, user_id: true, created_at: true, image_content_id: true } });
    for (const row of rows) {
      scanned++;
      try { const result = await registerExistingImage(row.user_id, row.id, { dryRun: !apply });
        bytesRead += result.size_bytes;
        hashes.add(`${row.user_id}:${result.sha256}`); if (result.content) registered++;
        reportHash.update(`${row.id}:${result.sha256}\n`); if (apply && !row.image_content_id) newLinks++;
      } catch (e) { failed++; const code = e instanceof ImageContentError ? e.code : "image_registration_failed"; failures[code] = (failures[code] ?? 0) + 1; }
      cursor = row;
    }
    if (rows.length < 100) break;
  }
  const unindexed = await prisma.uploadedAsset.count({ where: { image_content_id: null } });
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", scanned, registered, failed, unique_account_hashes: hashes.size,
    duplicates: scanned - failed - hashes.size, new_links: newLinks, new_contents: (await prisma.imageContent.count()) - beforeContents,
    failures, started_at: new Date(started).toISOString(), finished_at: new Date().toISOString(), runtime_ms: Date.now() - started,
    bytes_read: bytesRead, max_image_bytes: MAX_IMAGE_BYTES, max_image_pixels: 40_000_000,
    report_digest: reportHash.digest("hex"), unindexed, index_complete: failed === 0 && unindexed === 0,
    complete: apply && failed === 0 && unindexed === 0, object_writes: 0, object_deletions: 0 }));
  if (failed || (apply && unindexed)) process.exitCode = 1;
}
main().catch(() => { console.error("Image backfill failed; inspect configuration without printing credentials."); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
