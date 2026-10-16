import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { getObjectBytes } from "./storage";
import { ImageContentError, inspectOriginalImage, MAX_IMAGE_BYTES, ownedOriginalPath } from "./assets/image-content";
import { ImageInputError, type ImageAssetReference } from "./image-reference-contract";

type ReferenceDb = Pick<Prisma.TransactionClient, "uploadedAsset" | "characterVersion">;
export type ImageReferenceSnapshot = ImageAssetReference & { sha256: string };
export type PreparedImageReferences = {
  snapshots: ImageReferenceSnapshot[];
  images: Array<{ bytes: Buffer; mime: string }>;
  locations: string[];
};

async function ownedReferenceRows(db: ReferenceDb, userId: string, refs: ImageAssetReference[]) {
  const assets = await db.uploadedAsset.findMany({ where: { user_id: userId, id: { in: refs.map(r => r.asset_id) } }, include: { image_content: true } });
  const ordered = refs.map(ref => {
    const asset = assets.find(a => a.id === ref.asset_id);
    if (!asset) throw new ImageInputError("asset_not_found", 404);
    if (asset.image_content && asset.image_content.user_id !== userId) throw new ImageInputError("image_content_changed", 409);
    ownedOriginalPath(userId, asset.image_url);
    return asset;
  });
  for (const ref of refs) {
    if (!ref.character_version_id) continue;
    const version = await db.characterVersion.findFirst({ where: { id: ref.character_version_id, character: { user_id: userId } },
      include: { character: true, images: { where: { position: ref.image_index }, include: { image_content: true } } } });
    const image = version?.images[0], asset = ordered.find(a => a.id === ref.asset_id)!;
    if (!version || !image || image.asset_id !== ref.asset_id || image.image_content.user_id !== userId ||
      asset.image_content_id !== image.image_content_id) throw new ImageInputError("character_image_mismatch", 400);
    if (version.character.archived) throw new ImageInputError("character_archived", 409);
  }
  return ordered;
}

/** Complete ownership/provenance checks before any reads, then freeze the exact bytes used for every output. */
export async function prepareImageReferences(userId: string, refs: ImageAssetReference[], options: {
  db?: ReferenceDb; read?: typeof getObjectBytes;
} = {}): Promise<PreparedImageReferences> {
  try {
    const assets = await ownedReferenceRows(options.db ?? prisma, userId, refs);
    const images: PreparedImageReferences["images"] = [], snapshots: ImageReferenceSnapshot[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      let bytes: Buffer;
      try { ({ bytes } = await (options.read ?? getObjectBytes)(asset.image_url, { timeoutMs: 20_000, maxBytes: MAX_IMAGE_BYTES })); }
      catch { throw new ImageInputError("reference_image_unavailable", 422); }
      const meta = await inspectOriginalImage(bytes);
      if (asset.image_content && asset.image_content.sha256 !== meta.sha256) throw new ImageInputError("image_content_changed", 409);
      if (seen.has(meta.sha256)) throw new ImageInputError("duplicate_reference_image", 400);
      seen.add(meta.sha256);
      images.push({ bytes, mime: meta.mime });
      snapshots.push({ ...refs[i], sha256: meta.sha256 });
    }
    return { snapshots, images, locations: assets.map(a => a.image_url) };
  } catch (error) {
    if (error instanceof ImageContentError) throw new ImageInputError(error.code, error.status);
    throw error;
  }
}

/** Caller holds the account lock; archive/version/asset changes must be caught before charging. */
export async function recheckImageReferences(db: ReferenceDb, userId: string, prepared: PreparedImageReferences) {
  const assets = await ownedReferenceRows(db, userId, prepared.snapshots);
  assets.forEach((asset, i) => {
    if (asset.image_url !== prepared.locations[i] ||
      (asset.image_content && asset.image_content.sha256 !== prepared.snapshots[i].sha256))
      throw new ImageInputError("image_content_changed", 409);
  });
}
