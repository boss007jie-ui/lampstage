"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useLang } from "@/components/i18n/LangProvider";
import type { CharacterAsset, CharacterDetail, CharacterReference, CharacterSaveInput, CharacterSaveResponse, CharacterVersionInput } from "@/lib/characters/contracts";
import { descriptionControls, isCharacterAsset, isCharacterSave, isCursor, singleLineControls } from "./character-ui";

type Props = {
  initialReferences?: CharacterReference[];
  versionOf?: CharacterDetail;
  onClose: () => void;
  onSaved: (result: CharacterSaveResponse) => void;
  onSessionExpired: () => void;
  onRecheck: () => void;
};

/** Mount one dialog per explicit save/edit. Its request key survives uncertain retries. */
export function CharacterSaveDialog({ initialReferences = [], versionOf, onClose, onSaved, onSessionExpired, onRecheck }: Props) {
  const { lang } = useLang(), zh = lang === "zh", titleId = useId();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState(versionOf?.selected_version.description ?? "");
  const [selected, setSelected] = useState<CharacterReference[]>(() => (versionOf?.selected_version.reference_assets ?? initialReferences).map(r => ({ ...r })));
  const [assets, setAssets] = useState<CharacterAsset[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState(false);
  const [lastCursor, setLastCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [uploadNotice, setUploadNotice] = useState("");
  const [operation, setOperation] = useState<"upload" | "save" | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const active = useRef(false), sequence = useRef(0), pending = useRef<"upload" | "save" | null>(null);
  const attempt = useRef<{ fingerprint: string; body: CharacterSaveInput | CharacterVersionInput } | null>(null);
  const callbacks = useRef({ onClose, onSaved, onSessionExpired, onRecheck });
  callbacks.current = { onClose, onSaved, onSessionExpired, onRecheck };
  const expire = useCallback(() => {
    active.current = false; sequence.current++;
    setSelected([]); setAssets([]); setDescription(""); setName(""); setCategory(""); setError("");
    callbacks.current.onSessionExpired();
  }, []);
  const loadAssets = useCallback(async (next: string | null = null) => {
    const request = ++sequence.current;
    setAssetsLoading(true); setAssetsError(false); setLastCursor(next);
    const query = new URLSearchParams({ limit: "20" });
    if (next) query.set("cursor", next);
    try {
      const response = await fetch(`/api/account/character-assets?${query}`, { cache: "no-store" });
      if (!active.current || request !== sequence.current) return;
      if (response.status === 401) { expire(); return; }
      if (!response.ok) throw Error("assets_failed");
      const body = await response.json();
      if (!active.current || request !== sequence.current) return;
      if (!Array.isArray(body.assets) || !body.assets.every(isCharacterAsset) || !isCursor(body.next_cursor)) throw Error("invalid_assets");
      setAssets(previous => next ? [...previous, ...body.assets.filter((r: CharacterAsset) => !previous.some(p => p.asset_id === r.asset_id))] : body.assets);
      setCursor(body.next_cursor);
    } catch { if (active.current && request === sequence.current) setAssetsError(true); }
    finally { if (active.current && request === sequence.current) setAssetsLoading(false); }
  }, [expire]);
  useEffect(() => {
    active.current = true; void loadAssets();
    return () => { active.current = false; sequence.current++; };
  }, [loadAssets]);

  const locked = operation !== null || uncertain || conflict;
  function close() { if (!pending.current) callbacks.current.onClose(); }
  function add(reference: CharacterReference) {
    if (selected.some(r => r.asset_id === reference.asset_id || (reference.sha256 && r.sha256 === reference.sha256))) {
      setError(zh ? "这张图片已选中，请勿重复添加相同图片。" : "This image is already selected. Do not add identical images twice."); return;
    }
    if (selected.length >= 6) { setError(zh ? "每个人物版本最多选择 6 张图片。" : "Select up to 6 images per character version."); return; }
    setSelected(previous => [...previous, reference]); setError("");
  }
  function choose(asset: CharacterAsset) {
    if (locked) return;
    if (selected.some(r => r.asset_id === asset.asset_id)) { setSelected(previous => previous.filter(r => r.asset_id !== asset.asset_id)); setError(""); return; }
    add({ ...asset, label: zh ? `参考图 ${selected.length + 1}` : `Reference ${selected.length + 1}` });
  }
  function move(index: number, direction: -1 | 1) {
    if (locked || index + direction < 0 || index + direction >= selected.length) return;
    setSelected(previous => { const next = [...previous]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; });
  }
  async function upload(file: File) {
    if (pending.current || locked) return;
    if (!file.size || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.type)) {
      setError(zh ? "请选择 5 MB 以内的 JPG、PNG 或 WebP 图片。" : "Choose a JPG, PNG or WebP image up to 5 MB."); return;
    }
    if (selected.length >= 6) { setError(zh ? "请先移除一张已选图片，再上传。" : "Remove a selected image before uploading another."); return; }
    pending.current = "upload"; setOperation("upload"); setError(""); setUploadNotice("");
    const form = new FormData(); form.set("file", file);
    try {
      const response = await fetch("/api/account/character-assets", { method: "POST", body: form });
      if (!active.current) return;
      if (response.status === 401) { expire(); return; }
      const result = await response.json().catch(() => null);
      if (!active.current) return;
      if (!response.ok || !isCharacterAsset({ ...result, created_at: "" }) || result?.id !== result?.asset_id ||
        typeof result?.sha256 !== "string" || typeof result?.reused_content !== "boolean") throw Error("upload_failed");
      const asset: CharacterAsset = { ...result, created_at: "" };
      setAssets(previous => [asset, ...previous.filter(r => r.asset_id !== asset.asset_id)]);
      add({ ...asset, label: zh ? `参考图 ${selected.length + 1}` : `Reference ${selected.length + 1}` });
      setUploadNotice(result.reused_content
        ? (zh ? "已复用账户内的相同图片；请确认选择后保存人物。" : "Reused an identical image in your account. Confirm your selection, then save the character.")
        : (zh ? "图片已上传；点击保存人物后才会加入人物库。" : "Image uploaded. Save the character to add it to your library."));
    } catch { if (active.current) setError(zh ? "无法确认图片上传结果。可重新选择同一文件上传，相同文件会复用。" : "The upload could not be confirmed. You can select the same file again; identical files are reused."); }
    finally { pending.current = null; if (active.current) setOperation(null); }
  }
  async function save() {
    if (pending.current || conflict) return;
    if (!uncertain) {
      if ((!versionOf && (!name.trim() || name.length > 80 || category.length > 40 || singleLineControls.test(name + category))) ||
        description.length > 2000 || descriptionControls.test(description) || selected.length < 1 || selected.length > 6 ||
        selected.some(r => !r.label.trim() || r.label.length > 80 || singleLineControls.test(r.label))) {
        setError(zh ? "请填写人物名称（1–80 字），分类最多 40 字、说明最多 2000 字；选择 1–6 张图片，每张填写 1–80 字标签。" : "Enter a name (1–80 characters), category (up to 40) and description (up to 2000). Choose 1–6 images with labels of 1–80 characters."); return;
      }
      if (new Set(selected.map(r => r.asset_id)).size !== selected.length || new Set(selected.filter(r => r.sha256).map(r => r.sha256)).size !== selected.filter(r => r.sha256).length) {
        setError(zh ? "同一版本不能包含重复图片，请移除重复项。" : "A version cannot contain identical images. Remove duplicates."); return;
      }
      const fields = { description: description.trim(), reference_assets: selected.map(r => ({ asset_id: r.asset_id, label: r.label.trim() })) };
      const payload = versionOf ? { ...fields, expected_latest_version_id: versionOf.character.latest_version_id } : { ...fields, name: name.trim(), category: category.trim() };
      const fingerprint = JSON.stringify(payload);
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, body: versionOf ? payload as CharacterVersionInput : { ...payload, idempotency_key: crypto.randomUUID() } as CharacterSaveInput };
    }
    if (!attempt.current) return;
    pending.current = "save"; setOperation("save"); setError("");
    try {
      const response = await fetch(versionOf ? `/api/account/characters/${encodeURIComponent(versionOf.character.id)}/versions` : "/api/account/characters", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(attempt.current.body),
      });
      if (!active.current) return;
      if (response.status === 401) { expire(); return; }
      const result: unknown = await response.json().catch(() => null);
      if (!active.current) return;
      if (response.ok && isCharacterSave(result) && (!versionOf || result.character.id === versionOf.character.id)) {
        callbacks.current.onSaved(result); return;
      }
      const code = (result as { error?: string } | null)?.error;
      if (response.status === 409) {
        setConflict(true); setUncertain(false);
        setError(code === "character_version_changed"
          ? (zh ? "人物已有新版本，请返回详情刷新后重新编辑。" : "This character has a newer version. Return to its details, refresh and edit again.")
          : (zh ? "保存请求与当前记录冲突，请关闭并刷新人物库核对后再操作。" : "This save conflicts with the current record. Close and refresh the library before trying again."));
        callbacks.current.onRecheck();
      } else if ([400, 403, 404, 413, 415, 422, 429].includes(response.status)) {
        setUncertain(false);
        setError(response.status === 404 ? (zh ? "所选人物或图片已不可用，请刷新核对。" : "The selected character or image is unavailable. Refresh and check it.")
          : (zh ? "保存未成功，请检查图片是否重复、标签和内容长度，或稍后重试。" : "Saving failed. Check for duplicate images, labels and text limits, or retry later."));
      } else {
        setUncertain(true); callbacks.current.onRecheck();
        setError(zh ? "无法确认保存结果。已请求刷新人物库；可关闭核对，或使用原请求重试确认。" : "Saving could not be confirmed. A library refresh was requested. Close to check, or retry the same request.");
      }
    } catch {
      if (!active.current) return;
      setUncertain(true); callbacks.current.onRecheck();
      setError(zh ? "网络异常，无法确认保存结果。已请求刷新人物库；不会自动再次保存。可使用原请求重试确认。" : "A network error prevented confirmation. A library refresh was requested. No automatic save retry was made; you can retry the same request.");
    } finally { pending.current = null; if (active.current) setOperation(null); }
  }

  return <Dialog open onClose={close} titleId={titleId} className="!w-full !max-w-3xl">
    <h2 id={titleId} className="text-xl font-semibold">{versionOf ? (zh ? "保存人物新版本" : "Save a character version") : (zh ? "保存人物" : "Save character")}</h2>
    <p className="mt-2 text-sm text-[var(--color-muted)]">{zh ? "选择属于同一人物的参考图，并保存可复用的人物信息。人物和动作模板分别保存。" : "Choose reference images of the same person and save their reusable details. Characters and action templates are saved separately."}</p>
    {versionOf && <p className="mt-3 text-sm font-semibold">{versionOf.character.code} · {versionOf.character.name} · {zh ? `基于版本 ${versionOf.selected_version.version}` : `Based on Version ${versionOf.selected_version.version}`}</p>}
    <fieldset disabled={locked} className="mt-5 min-w-0 space-y-4">
      {!versionOf && <div className="grid min-w-0 gap-4 sm:grid-cols-2"><label className="block min-w-0 text-sm">{zh ? "人物名称" : "Character name"}<input name="character_name" value={name} onChange={event => setName(event.target.value)} className="input mt-2 w-full" /></label><label className="block min-w-0 text-sm">{zh ? "分类（选填）" : "Category (optional)"}<input name="character_category" value={category} onChange={event => setCategory(event.target.value)} className="input mt-2 w-full" /></label></div>}
      <label className="block text-sm">{zh ? "人物说明（选填）" : "Character description (optional)"}<textarea name="character_description" rows={3} value={description} onChange={event => setDescription(event.target.value)} className="input mt-2 w-full resize-y" /></label>
      <div><h3 className="text-sm font-semibold">{zh ? `已选参考图（${selected.length}/6）` : `Selected references (${selected.length}/6)`}</h3>
        {selected.length === 0 && <p className="mt-2 text-sm text-[var(--color-muted)]">{zh ? "从下方选择已有图片，或上传新图片。" : "Choose existing images below or upload an image."}</p>}
        <ol className="mt-3 space-y-3">{selected.map((r, index) => <li key={r.asset_id} className="flex min-w-0 items-start gap-3 rounded-lg border border-[var(--color-border)] p-3">
          <img src={r.image_url} alt={zh ? `已选参考图 ${index + 1}` : `Selected reference ${index + 1}`} className="h-20 w-16 shrink-0 rounded object-cover" />
          <div className="min-w-0 flex-1"><label className="block text-xs">{zh ? `图片 ${index + 1} 标签` : `Image ${index + 1} label`}<input name={`character_label_${index}`} value={r.label} onChange={event => setSelected(previous => previous.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} className="input mt-1 w-full" /></label>
            <div className="mt-2 flex flex-wrap gap-3 text-xs"><button type="button" disabled={locked || index === 0} onClick={() => move(index, -1)} className="underline disabled:opacity-40">{zh ? "上移" : "Move up"}</button><button type="button" disabled={locked || index === selected.length - 1} onClick={() => move(index, 1)} className="underline disabled:opacity-40">{zh ? "下移" : "Move down"}</button><button type="button" onClick={() => setSelected(previous => previous.filter(item => item.asset_id !== r.asset_id))} className="underline">{zh ? "移除" : "Remove"}</button></div>
          </div>
        </li>)}</ol>
      </div>
      <div className="border-t border-[var(--color-border)] pt-4"><h3 className="text-sm font-semibold">{zh ? "选择已有图片" : "Choose existing images"}</h3>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">{assets.map(asset => <button key={asset.asset_id} type="button" aria-label={zh ? `选择图片 ${asset.asset_id}` : `Select image ${asset.asset_id}`} aria-pressed={selected.some(r => r.asset_id === asset.asset_id)} onClick={() => choose(asset)} className={`min-w-0 overflow-hidden rounded-lg border p-1 ${selected.some(r => r.asset_id === asset.asset_id) ? "border-[var(--color-accent)] bg-[var(--color-raised)]" : "border-[var(--color-border)]"}`}><img src={asset.image_url} alt="" className="aspect-square w-full rounded object-cover" /><span className="mt-1 block text-xs">{selected.some(r => r.asset_id === asset.asset_id) ? (zh ? "已选择" : "Selected") : (zh ? "选择" : "Select")}</span></button>)}</div>
        {assetsLoading && <p role="status" className="mt-3 text-sm">{zh ? "正在读取图片…" : "Loading images…"}</p>}
        {assetsError && <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">{zh ? "无法读取图片，请重试。" : "Could not load images. Please retry."}</p>}
        {!assetsLoading && assets.length === 0 && !assetsError && <p className="mt-3 text-sm text-[var(--color-muted)]">{zh ? "还没有可选图片。" : "No images available yet."}</p>}
        {!assetsLoading && (assetsError || cursor) && <button type="button" onClick={() => void loadAssets(assetsError ? lastCursor : cursor)} className="btn btn-outline mt-3 !min-h-0 !py-2">{assetsError ? (zh ? "重试读取图片" : "Retry images") : (zh ? "加载更多图片" : "Load more images")}</button>}
      </div>
      <label className="block text-sm">{zh ? "上传参考图" : "Upload reference image"}<input type="file" name="character_image" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full min-w-0 text-sm" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /><span className="mt-2 block text-xs text-[var(--color-muted)]">{zh ? "JPG、PNG、WebP，单张最多 5 MB。相同文件会复用；裁剪或重新编码后的图片视为新文件。" : "JPG, PNG or WebP, up to 5 MB each. Identical files are reused; cropping or re-encoding creates a different file."}</span></label>
    </fieldset>
    {uploadNotice && <p role="status" className="mt-4 text-sm text-[var(--color-muted)]">{uploadNotice}</p>}
    {operation === "upload" && <p role="status" className="mt-4 text-sm">{zh ? "正在上传图片…" : "Uploading image…"}</p>}
    {error && <p role="alert" className="mt-4 text-sm text-[var(--color-danger)]">{error}</p>}
    <div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" className="btn btn-outline" disabled={operation !== null} onClick={close}>{zh ? "返回" : "Back"}</button><button type="button" className="btn btn-primary" disabled={operation !== null || conflict} aria-busy={operation === "save"} onClick={() => void save()}>{operation === "save" ? (zh ? "保存中…" : "Saving…") : uncertain ? (zh ? "重试确认保存" : "Retry same save") : versionOf ? (zh ? "保存新版本" : "Save new version") : (zh ? "保存人物" : "Save character")}</button></div>
  </Dialog>;
}
