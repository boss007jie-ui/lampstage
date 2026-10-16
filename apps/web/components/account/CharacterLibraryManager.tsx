"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useLang } from "@/components/i18n/LangProvider";
import type { CharacterDetail, CharacterListResponse, CharacterSaveResponse, CharacterSummary } from "@/lib/characters/contracts";
import { CharacterSaveDialog } from "./CharacterSaveDialog";
import { characterSavedMessage, isCharacterDetail, isCharacterSummary, isCursor, singleLineControls } from "./character-ui";

type Filter = "active" | "archived" | "all";
type Page = { filter: Filter; q: string; cursors: (string | null)[]; index: number };
type Notice = { text: string; error: boolean };
const firstPage: Page = { filter: "active", q: "", cursors: [null], index: 0 };
const filters: [Filter, string, string][] = [["active", "使用中", "Active"], ["archived", "已归档", "Archived"], ["all", "全部", "All"]];

export function CharacterLibraryManager({ onSessionExpired, onBusyChange, disabled = false, refreshKey = 0 }: {
  onSessionExpired: () => void; onBusyChange: (busy: boolean) => void; disabled?: boolean; refreshKey?: number;
}) {
  const { lang } = useLang(), zh = lang === "zh";
  const [data, setData] = useState<CharacterListResponse | null>(null);
  const [page, setPage] = useState(firstPage), pageRef = useRef(firstPage);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true), [readError, setReadError] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [view, setView] = useState<"detail" | "metadata" | "archive" | null>(null);
  const [detail, setDetail] = useState<CharacterDetail | null>(null);
  const [target, setTarget] = useState<{ id: string; version?: string } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState(false);
  const [editor, setEditor] = useState<{ versionOf?: CharacterDetail } | null>(null);
  const [name, setName] = useState(""), [category, setCategory] = useState(""), [formError, setFormError] = useState("");
  const [mutating, setMutating] = useState(false), [copying, setCopying] = useState(false);
  const active = useRef(false), listSequence = useRef(0), detailSequence = useRef(0), pending = useRef(false);
  const callbacks = useRef({ onSessionExpired, onBusyChange });
  callbacks.current = { onSessionExpired, onBusyChange };
  const ownBusy = view !== null || editor !== null || mutating;
  const expire = useCallback(() => {
    active.current = false; listSequence.current++; detailSequence.current++;
    setData(null); setDetail(null); setEditor(null); setView(null); setNotice(null); setTarget(null);
    callbacks.current.onSessionExpired();
  }, []);

  const load = useCallback(async (next: Page) => {
    if (!active.current) return;
    const sequence = ++listSequence.current;
    setLoading(true); setReadError(false);
    const params = new URLSearchParams({ status: next.filter, limit: "20" });
    if (next.q) params.set("q", next.q);
    if (next.cursors[next.index]) params.set("cursor", next.cursors[next.index]!);
    try {
      const response = await fetch(`/api/account/characters?${params}`, { cache: "no-store" });
      if (!active.current || sequence !== listSequence.current) return;
      if (response.status === 401) { expire(); return; }
      if (!response.ok) throw Error("list_failed");
      const body = await response.json();
      if (!active.current || sequence !== listSequence.current) return;
      if (!Array.isArray(body.characters) || !body.characters.every(isCharacterSummary) || !isCursor(body.next_cursor)) throw Error("invalid_list");
      setData(body); setPage(next); pageRef.current = next;
    } catch { if (active.current && sequence === listSequence.current) setReadError(true); }
    finally { if (active.current && sequence === listSequence.current) setLoading(false); }
  }, [expire]);
  const loadDetail = useCallback(async (id: string, version?: string) => {
    if (!active.current) return;
    const sequence = ++detailSequence.current;
    setTarget({ id, version }); setDetailLoading(true); setDetailError(false);
    try {
      const response = await fetch(`/api/account/characters/${encodeURIComponent(id)}${version ? `?version_id=${encodeURIComponent(version)}` : ""}`, { cache: "no-store" });
      if (!active.current || sequence !== detailSequence.current) return;
      if (response.status === 401) { expire(); return; }
      if (!response.ok) throw Error("detail_failed");
      const body: unknown = await response.json();
      if (!active.current || sequence !== detailSequence.current) return;
      if (!isCharacterDetail(body) || body.character.id !== id || (version && body.selected_version.id !== version)) throw Error("invalid_detail");
      setDetail(body);
    } catch { if (active.current && sequence === detailSequence.current) setDetailError(true); }
    finally { if (active.current && sequence === detailSequence.current) setDetailLoading(false); }
  }, [expire]);
  useEffect(() => {
    active.current = true; void load(firstPage);
    return () => { active.current = false; listSequence.current++; detailSequence.current++; };
  }, [load]);
  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) { firstRefresh.current = false; return; }
    void load(pageRef.current);
  }, [refreshKey, load]);
  useEffect(() => { callbacks.current.onBusyChange(ownBusy); }, [ownBusy]);
  useEffect(() => () => callbacks.current.onBusyChange(false), []);

  function open(character: CharacterSummary) {
    if (disabled || pending.current) return;
    setNotice(null); setDetail(null); setView("detail"); void loadDetail(character.id);
  }
  function close() {
    if (pending.current) return;
    detailSequence.current++; setView(null); setDetail(null); setTarget(null); setFormError("");
  }
  function recheck() {
    void load(pageRef.current);
    if (target) void loadDetail(target.id, target.version);
  }
  function saved(result: CharacterSaveResponse) {
    if (!active.current) return;
    setEditor(null); setView("detail"); setDetail(null);
    setNotice({ error: false, text: characterSavedMessage(result, zh) });
    void loadDetail(result.character.id, result.selected_version.id); void load(pageRef.current);
  }
  function searchCharacters() {
    if (loading || disabled || ownBusy) return;
    if (search.length > 80 || singleLineControls.test(search)) {
      setNotice({ error: true, text: zh ? "搜索内容最多 80 个字符，且不能包含控制字符。" : "Search accepts up to 80 characters without control characters." }); return;
    }
    setNotice(null); void load({ filter: page.filter, q: search.trim(), cursors: [null], index: 0 });
  }
  async function mutate(kind: "metadata" | "archive") {
    if (!detail || disabled || pending.current || detailLoading || detailError) return;
    if (kind === "metadata" && (!name.trim() || name.length > 80 || category.length > 40 || singleLineControls.test(name + category))) {
      setFormError(zh ? "名称需为 1–80 个字符，分类最多 40 个字符，不能包含控制字符。" : "Name must be 1–80 characters and category up to 40, without control characters."); return;
    }
    const id = detail.character.id;
    const body = kind === "metadata" ? { name: name.trim(), category: category.trim() } : { archived: !detail.character.archived };
    pending.current = true; setMutating(true); setFormError(""); setNotice(null);
    try {
      const response = await fetch(`/api/account/characters/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!active.current) return;
      if (response.status === 401) { expire(); return; }
      const result = await response.json().catch(() => null);
      if (!active.current) return;
      if (response.ok && isCharacterSummary(result?.character) && result.character.id === id &&
        (kind === "metadata" ? result.character.name === body.name && result.character.category === body.category : result.character.archived === body.archived)) {
        setDetail(previous => previous ? { ...previous, character: result.character } : previous);
        setNotice({ error: false, text: kind === "metadata" ? (zh ? "人物信息已更新。" : "Character details updated.")
          : result.character.archived ? (zh ? "人物已归档，已有模板和任务仍保留原版本。" : "Character archived. Existing templates and tasks retain their fixed versions.")
            : (zh ? "人物已恢复，可用于新的选择。" : "Character restored and available for new selections.") });
      } else setNotice({ error: true, text: zh ? "无法确认修改，请刷新核对后再操作。" : "The update could not be confirmed. Refresh and check before trying again." });
      setView("detail"); void loadDetail(id, detail.selected_version.id); void load(pageRef.current);
    } catch {
      if (!active.current) return;
      setView("detail"); setNotice({ error: true, text: zh ? "网络异常，无法确认修改。已重新查询，不会自动再次提交。" : "A network error prevented confirmation. We checked again; no automatic retry was made." });
      void loadDetail(id, detail.selected_version.id); void load(pageRef.current);
    } finally { pending.current = false; if (active.current) setMutating(false); }
  }
  async function copyVersion() {
    if (!detail || copying || detailLoading || detailError || disabled) return;
    setCopying(true); setNotice(null);
    try {
      if (!navigator.clipboard?.writeText) throw Error("clipboard_unavailable");
      await navigator.clipboard.writeText(`Character: ${detail.character.code} (${detail.character.id})\nVersion: ${detail.selected_version.version} (${detail.selected_version.id})`);
      if (active.current) setNotice({ error: false, text: zh ? "人物与固定版本 ID 已复制，可交给 Expert 选择使用。" : "Character and fixed version IDs copied for Expert reuse." });
    } catch { if (active.current) setNotice({ error: true, text: zh ? "复制失败，请手动选择版本 ID 复制。" : "Copy failed. Select and copy the version ID manually." }); }
    finally { if (active.current) setCopying(false); }
  }
  const listBusy = loading || disabled || ownBusy;
  const detailBusy = detailLoading || detailError || disabled || mutating;
  return <section id="characters" aria-labelledby="characters-heading" className="mt-8 border-b border-[var(--color-border)] pb-10">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="characters-heading" className="text-xl font-semibold">{zh ? "人物库" : "Character library"}</h2><p className="mt-2 max-w-xl text-sm text-[var(--color-muted)]">{zh ? "保存人物参考图和固定版本，用于不同动作模板。只有明确保存，人物才会加入库中。" : "Save character references and fixed versions for different action templates. Characters enter the library only when you choose to save them."}</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={listBusy} onClick={() => { setNotice(null); void load(pageRef.current); }}>{loading ? (zh ? "刷新中…" : "Refreshing…") : (zh ? "刷新人物库" : "Refresh characters")}</button><button type="button" className="btn btn-primary !min-h-0 !py-2" disabled={disabled || ownBusy} onClick={() => { setNotice(null); setEditor({}); }}>{zh ? "保存人物" : "Save character"}</button></div>
    </div>
    {notice && view === null && !editor && <p role={notice.error ? "alert" : "status"} className={`mt-4 text-sm ${notice.error ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>{notice.text}</p>}
    {readError && <p role="alert" className="mt-4 text-sm text-[var(--color-danger)]">{data ? (zh ? "人物库刷新失败，仍显示上次结果；请重试刷新。" : "The character library could not be refreshed. Last results remain visible; refresh to retry.") : (zh ? "人物库暂时无法加载，请重试刷新。" : "The character library could not be loaded. Refresh to retry.")}</p>}
    <form className="mt-5 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); searchCharacters(); }}><label className="min-w-0 flex-1 text-sm">{zh ? "按编号或名称搜索" : "Search by code or name"}<input name="character_search" value={search} disabled={listBusy} onChange={event => setSearch(event.target.value)} placeholder={zh ? "例如 C001 或妈妈" : "e.g. C001 or a name"} className="input mt-2 w-full" /></label><button type="submit" className="btn btn-outline" disabled={listBusy}>{zh ? "搜索人物" : "Search characters"}</button></form>
    <div role="group" aria-label={zh ? "筛选人物" : "Filter characters"} className="mt-4 flex flex-wrap gap-2">{filters.map(([filter, cn, en]) => <button key={filter} type="button" className={`btn ${page.filter === filter ? "btn-primary" : "btn-outline"} !min-h-0 !px-4 !py-2`} aria-pressed={page.filter === filter} disabled={listBusy} onClick={() => { setNotice(null); void load({ filter, q: page.q, cursors: [null], index: 0 }); }}>{zh ? cn : en}</button>)}</div>
    <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2" aria-busy={loading}>
      {!data && loading && <p role="status" className="surface p-6 text-sm">{zh ? "正在读取人物库…" : "Loading characters…"}</p>}
      {data?.characters.length === 0 && <p className="surface p-6 text-sm text-[var(--color-muted)]">{zh ? "没有符合条件的人物。可以调整筛选，或保存一个人物。" : "No matching characters. Adjust the filters or save a character."}</p>}
      {data?.characters.map(character => <article key={character.id} className="surface flex min-w-0 flex-col p-5">
        {character.cover_url ? <img src={character.cover_url} alt={zh ? `${character.name}的原参考图` : `Original reference for ${character.name}`} className="mb-4 aspect-[4/3] w-full rounded-lg bg-[var(--color-raised)] object-contain" /> : <div className="mb-4 flex aspect-[4/3] items-center justify-center rounded-lg bg-[var(--color-raised)] text-sm text-[var(--color-muted)]">{zh ? "暂无参考图" : "No reference image"}</div>}
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="break-words font-semibold [overflow-wrap:anywhere]">{character.name}</h3><code className="rounded bg-[var(--color-raised)] px-2 py-1 text-xs">{character.code}</code></div>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{character.category || (zh ? "未分类" : "Uncategorized")} · {zh ? `${character.version_count} 个版本 · ${character.reference_count} 张参考图` : `${character.version_count} versions · ${character.reference_count} references`}{character.archived ? (zh ? " · 已归档" : " · Archived") : ""}</p>
        <button type="button" className="btn btn-outline mt-4 self-start !min-h-0 !py-2" disabled={listBusy} onClick={() => open(character)}>{zh ? "查看人物" : "View character"}</button>
      </article>)}
    </div>
    {data && <div className="mt-5 flex items-center justify-between gap-3"><button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={listBusy || page.index === 0} onClick={() => void load({ ...page, index: page.index - 1 })}>{zh ? "上一页" : "Previous page"}</button><span className="text-xs text-[var(--color-muted)]">{zh ? `第 ${page.index + 1} 页` : `Page ${page.index + 1}`}</span><button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={listBusy || !data.next_cursor} onClick={() => { if (data.next_cursor) void load({ ...page, cursors: [...page.cursors.slice(0, page.index + 1), data.next_cursor], index: page.index + 1 }); }}>{zh ? "下一页" : "Next page"}</button></div>}
    <Dialog open={view !== null && !editor} onClose={close} titleId="character-detail-title" className="!w-full !max-w-2xl">
      <h2 id="character-detail-title" className="text-xl font-semibold">{view === "metadata" ? (zh ? "编辑人物信息" : "Edit character details") : view === "archive" ? (detail?.character.archived ? (zh ? "恢复人物？" : "Restore character?") : (zh ? "归档人物？" : "Archive character?")) : (zh ? "人物版本" : "Character versions")}</h2>
      {notice && <p role={notice.error ? "alert" : "status"} className={`mt-4 text-sm ${notice.error ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>{notice.text}</p>}
      {detailLoading && <p role="status" className="mt-4 text-sm">{zh ? "正在读取人物…" : "Loading character…"}</p>}
      {detailError && <p role="alert" className="mt-4 text-sm text-[var(--color-danger)]">{zh ? "人物详情读取失败，当前显示可能已过时，请刷新核对。" : "Character details could not be loaded and may be out of date. Refresh to check."}</p>}
      {detail && <>
        <p className="mt-4 break-words font-semibold [overflow-wrap:anywhere]">{detail.character.code} · {detail.character.name}{detail.character.archived ? (zh ? "（已归档）" : " (Archived)") : ""}</p>
        <p className="mt-1 break-words text-sm text-[var(--color-muted)]">{detail.character.category || (zh ? "未分类" : "Uncategorized")}</p>
        {view === "metadata" ? <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void mutate("metadata"); }}><label className="block text-sm">{zh ? "人物名称" : "Character name"}<input name="edit_character_name" value={name} disabled={mutating} onChange={event => setName(event.target.value)} className="input mt-2 w-full" /></label><label className="block text-sm">{zh ? "分类" : "Category"}<input name="edit_character_category" value={category} disabled={mutating} onChange={event => setCategory(event.target.value)} className="input mt-2 w-full" /></label>{formError && <p role="alert" className="text-sm text-[var(--color-danger)]">{formError}</p>}<div className="flex flex-wrap justify-end gap-3"><button type="button" className="btn btn-outline" disabled={mutating} onClick={() => setView("detail")}>{zh ? "取消" : "Cancel"}</button><button type="submit" className="btn btn-primary" disabled={detailBusy}>{zh ? "保存信息" : "Save details"}</button></div></form>
          : view === "archive" ? <div className="mt-4"><p className="text-sm text-[var(--color-muted)]">{detail.character.archived ? (zh ? "恢复后可重新选择此人物，编号和版本保持不变。" : "Restoring allows new selections of this character. Its code and versions stay the same.") : (zh ? "归档后不再用于新的选择。已有模板和任务继续引用原固定版本。" : "Archiving prevents new selections. Existing templates and tasks keep their fixed version references.")}</p><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" className="btn btn-outline" disabled={mutating} onClick={() => setView("detail")}>{zh ? "取消" : "Cancel"}</button><button type="button" className="btn btn-outline" disabled={detailBusy} onClick={() => void mutate("archive")}>{detail.character.archived ? (zh ? "确认恢复" : "Confirm restore") : (zh ? "确认归档" : "Confirm archive")}</button></div></div>
            : <div className="mt-5 space-y-4"><label className="block text-sm">{zh ? "查看固定版本" : "View fixed version"}<select name="character_version" value={detail.selected_version.id} disabled={detailBusy} onChange={event => void loadDetail(detail.character.id, event.target.value)} className="input mt-2 w-full">{detail.versions.map(version => <option key={version.id} value={version.id}>{zh ? `版本 ${version.version}` : `Version ${version.version}`}</option>)}</select></label>
              <p className="text-sm text-[var(--color-muted)]">{zh ? `当前查看版本 ${detail.selected_version.version}。创建新版本不会改动已保存的模板和任务。` : `Viewing Version ${detail.selected_version.version}. New versions do not change saved templates or tasks.`}</p><code className="block break-all text-xs">{detail.selected_version.id}</code>
              <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{detail.selected_version.description || (zh ? "此版本暂无人物说明。" : "No character description for this version.")}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{detail.selected_version.reference_assets.map(reference => <figure key={reference.index} className="min-w-0"><img src={reference.image_url} alt={reference.label} className="aspect-square w-full rounded-lg bg-[var(--color-raised)] object-contain" /><figcaption className="mt-2 break-words text-xs [overflow-wrap:anywhere]">{reference.index + 1}. {reference.label}</figcaption></figure>)}</div>
              <div className="flex flex-wrap gap-2"><button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={detailBusy || copying} onClick={() => void copyVersion()}>{zh ? "复制固定版本 ID" : "Copy fixed version IDs"}</button><button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={detailBusy} onClick={() => { setName(detail.character.name); setCategory(detail.character.category); setFormError(""); setNotice(null); setView("metadata"); }}>{zh ? "编辑信息" : "Edit details"}</button><button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={detailBusy || detail.character.archived} onClick={() => { setNotice(null); setEditor({ versionOf: detail }); }}>{zh ? "添加新版本" : "Add new version"}</button><button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={detailBusy} onClick={() => { setNotice(null); setView("archive"); }}>{detail.character.archived ? (zh ? "恢复人物" : "Restore character") : (zh ? "归档人物" : "Archive character")}</button></div>
            </div>}
      </>}
      <div className="mt-5 flex flex-wrap gap-3"><button type="button" className="btn btn-outline" disabled={mutating} onClick={close}>{zh ? "关闭" : "Close"}</button>{view === "detail" && target && <button type="button" className="btn btn-outline" disabled={detailLoading || mutating} onClick={() => void loadDetail(target.id, target.version)}>{zh ? "刷新人物详情" : "Refresh character details"}</button>}</div>
    </Dialog>
    {editor && <CharacterSaveDialog versionOf={editor.versionOf} onClose={() => setEditor(null)} onSaved={saved} onSessionExpired={expire} onRecheck={recheck} />}
  </section>;
}
