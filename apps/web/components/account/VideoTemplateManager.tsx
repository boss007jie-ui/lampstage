"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/components/i18n/LangProvider";
import { Dialog } from "@/components/ui/Dialog";
import type { VideoTemplateDetail, VideoTemplateSummary } from "@/lib/video/template-contracts";

type Filter = "active" | "archived" | "all";
type Page = { filter: Filter; cursors: (string | null)[]; index: number };
type Notice = { error: boolean; text: string };
type View = "detail" | "edit" | "archive" | null;
const firstPage: Page = { filter: "active", cursors: [null], index: 0 };
const filters: [Filter, string, string][] = [["active", "使用中", "Active"], ["archived", "已归档", "Archived"], ["all", "全部", "All"]];

function isSummary(value: unknown): value is VideoTemplateSummary {
  const v = value as VideoTemplateSummary | null;
  return Boolean(v && typeof v.id === "string" && typeof v.code === "string" && typeof v.name === "string" &&
    typeof v.category === "string" && typeof v.archived === "boolean" && typeof v.latest_version_id === "string" &&
    Number.isInteger(v.version_count) && v.version_count >= 1 &&
    [v.thumbnail_url, v.source_url, v.preview_url].every(x => x === null || typeof x === "string"));
}
function isDetail(value: unknown): value is VideoTemplateDetail {
  const v = value as VideoTemplateDetail | null;
  return Boolean(v && isSummary(v.template) && Array.isArray(v.versions) && v.versions.every(x =>
    x && typeof x.id === "string" && Number.isInteger(x.version) && typeof x.source_job_id === "string") &&
    v.selected_version && typeof v.selected_version.id === "string" && Number.isInteger(v.selected_version.version) &&
    (v.selected_version.character_bindings === undefined || (Array.isArray(v.selected_version.character_bindings) &&
      v.selected_version.character_bindings.every(binding => binding && typeof binding.code === "string" &&
        typeof binding.name === "string" && typeof binding.character_version_id === "string" &&
        Number.isInteger(binding.version) && binding.version >= 1 && Number.isInteger(binding.image_index) &&
        binding.image_index >= 0 && binding.image_index <= 5 && Number.isInteger(binding.segment_index) &&
        Number.isInteger(binding.reference_index)))) &&
    v.versions.some(x => x.id === v.selected_version.id));
}
function matchesFilter(item: VideoTemplateSummary, filter: Filter) {
  return filter === "all" || item.archived === (filter === "archived");
}

export function VideoTemplateManager({ onSessionExpired, onBusyChange, disabled = false, refreshKey = 0 }: {
  onSessionExpired: () => void; onBusyChange: (busy: boolean) => void; disabled?: boolean; refreshKey?: number;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [data, setData] = useState<{ templates: VideoTemplateSummary[]; next_cursor: string | null } | null>(null);
  const [page, setPage] = useState<Page>(firstPage);
  const pageRef = useRef(firstPage);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [detail, setDetail] = useState<VideoTemplateDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [detailTarget, setDetailTarget] = useState<{ id: string; versionId?: string } | null>(null);
  const [mediaError, setMediaError] = useState(false);
  const [mediaRevision, setMediaRevision] = useState(0);
  const [view, setView] = useState<View>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [formError, setFormError] = useState("");
  const [mutating, setMutating] = useState(false);
  const [copying, setCopying] = useState(false);
  const mounted = useRef(false);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const pending = useRef(false);
  const expireRef = useRef(onSessionExpired);
  const busyRef = useRef(onBusyChange);
  expireRef.current = onSessionExpired;
  busyRef.current = onBusyChange;
  const ownBusy = view === "edit" || view === "archive" || mutating;
  // The parent may include this component's busy state in `disabled`.
  const unavailable = disabled && !ownBusy;

  const clearPrivate = useCallback(() => {
    listRequest.current++; detailRequest.current++;
    setData(null); setDetail(null); setDetailTarget(null); setView(null); setNotice(null);
    setLoading(false); setDetailLoading(false); setReadError(false); setDetailError(false);
    expireRef.current();
  }, []);
  const load = useCallback(async (next: Page) => {
    const sequence = ++listRequest.current;
    setLoading(true); setReadError(false);
    const query = new URLSearchParams({ status: next.filter, limit: "20" });
    const cursor = next.cursors[next.index];
    if (cursor !== null) query.set("cursor", cursor);
    try {
      const response = await fetch(`/api/account/video-templates?${query}`, { cache: "no-store" });
      if (!mounted.current || sequence !== listRequest.current) return false;
      if (response.status === 401) { clearPrivate(); return false; }
      if (!response.ok) throw Error("read_failed");
      const body: unknown = await response.json();
      if (!mounted.current || sequence !== listRequest.current) return false;
      const result = body as { templates?: unknown; next_cursor?: unknown };
      if (!Array.isArray(result.templates) || !result.templates.every(isSummary) ||
        !(result.next_cursor === null || typeof result.next_cursor === "string")) throw Error("invalid_list");
      setData({ templates: result.templates, next_cursor: result.next_cursor });
      pageRef.current = next; setPage(next);
      return true;
    } catch {
      if (mounted.current && sequence === listRequest.current) setReadError(true);
      return false;
    } finally {
      if (mounted.current && sequence === listRequest.current) setLoading(false);
    }
  }, [clearPrivate]);

  const loadDetail = useCallback(async (id: string, versionId?: string) => {
    const sequence = ++detailRequest.current;
    setDetailTarget({ id, versionId });
    setDetailLoading(true); setDetailError(false);
    const suffix = versionId ? `?version_id=${encodeURIComponent(versionId)}` : "";
    try {
      const response = await fetch(`/api/account/video-templates/${encodeURIComponent(id)}${suffix}`, { cache: "no-store" });
      if (!mounted.current || sequence !== detailRequest.current) return;
      if (response.status === 401) { clearPrivate(); return; }
      if (!response.ok) throw Error("detail_failed");
      const body: unknown = await response.json();
      if (!mounted.current || sequence !== detailRequest.current) return;
      if (!isDetail(body) || body.template.id !== id || (versionId && body.selected_version.id !== versionId)) throw Error("invalid_detail");
      setDetail(body); setMediaError(false); setMediaRevision(value => value + 1);
    } catch {
      if (mounted.current && sequence === detailRequest.current) setDetailError(true);
    } finally {
      if (mounted.current && sequence === detailRequest.current) setDetailLoading(false);
    }
  }, [clearPrivate]);

  useEffect(() => {
    mounted.current = true;
    void load(firstPage);
    return () => { mounted.current = false; listRequest.current++; detailRequest.current++; };
  }, [load]);
  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) { firstRefresh.current = false; return; }
    void load(pageRef.current);
  }, [refreshKey, load]);
  useEffect(() => {
    busyRef.current(ownBusy);
  }, [ownBusy]);
  useEffect(() => () => busyRef.current(false), []);

  function move(next: Page) {
    if (loading || pending.current || unavailable) return;
    setNotice(null); void load(next);
  }
  function open(item: VideoTemplateSummary) {
    if (unavailable || pending.current) return;
    setDetail(null); setDetailError(false); setNotice(null); setView("detail");
    void loadDetail(item.id);
  }
  function close() {
    if (pending.current) return;
    detailRequest.current++; setView(null); setDetail(null); setDetailTarget(null); setDetailError(false); setFormError("");
  }
  function edit() {
    if (!detail || unavailable || pending.current || detailLoading || detailError) return;
    setName(detail.template.name); setCategory(detail.template.category); setFormError(""); setView("edit");
  }
  async function mutate(kind: "edit" | "archive") {
    if (!detail || pending.current || unavailable || detailLoading || detailError) return;
    const current = detail.template;
    let body: { name?: string; category?: string; archived?: boolean };
    if (kind === "edit") {
      if (name.trim().length < 1 || name.length > 80 || category.length > 40) {
        setFormError(zh ? "名称需为 1–80 个字符，分类最多 40 个字符。" : "Name must be 1–80 characters; category may be up to 40 characters."); return;
      }
      body = { name: name.trim(), category: category.trim() };
    } else body = { archived: !current.archived };
    pending.current = true; setMutating(true); setFormError(""); setNotice(null);
    try {
      const response = await fetch(`/api/account/video-templates/${encodeURIComponent(current.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!mounted.current) return;
      if (response.status === 401) { clearPrivate(); return; }
      const result = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (!response.ok || !isSummary(result?.template) || result.template.id !== current.id || result.template.code !== current.code ||
        result.template.latest_version_id !== current.latest_version_id || result.template.version_count !== current.version_count ||
        (kind === "archive" && result.template.archived !== body.archived) ||
        (kind === "edit" && (result.template.name !== body.name || result.template.category !== body.category))) {
        const status = response.status;
        setNotice({ error: true, text: status === 404
          ? (zh ? "找不到此模板，请刷新核对。" : "This template could not be found. Refresh and check it.")
          : status === 409 ? (zh ? "模板状态已变化，无法确认修改；请刷新核对。" : "The template changed; we could not confirm the update. Refresh and check it.")
            : (zh ? "无法确认修改，请刷新核对；不会自动重试。" : "We could not confirm the update. Refresh and check it; no automatic retry was made.") });
        setView("detail"); await loadDetail(current.id); await load(pageRef.current); return;
      }
      const updated = result.template as VideoTemplateSummary;
      setData(previous => previous ? { ...previous, templates: previous.templates.map(item => item.id === current.id ? updated : item).filter(item => matchesFilter(item, pageRef.current.filter)) } : previous);
      setDetail(previous => previous ? { ...previous, template: updated } : previous);
      setView("detail");
      setNotice({ error: false, text: kind === "edit" ? (zh ? "模板信息已更新。" : "Template details updated.") : updated.archived ? (zh ? "模板已归档。" : "Template archived.") : (zh ? "模板已恢复。" : "Template restored.") });
      await load(pageRef.current);
    } catch {
      if (!mounted.current) return;
      setView("detail");
      setNotice({ error: true, text: zh ? "网络异常，无法确认修改；请刷新核对后再操作。" : "Network error: we could not confirm the update. Refresh and check before trying again." });
      await loadDetail(current.id); await load(pageRef.current);
    } finally {
      pending.current = false;
      if (mounted.current) setMutating(false);
    }
  }
  async function copyIds() {
    if (!detail || copying || pending.current || unavailable) return;
    setCopying(true); setNotice(null);
    try {
      if (!navigator.clipboard?.writeText) throw Error("clipboard_unavailable");
      await navigator.clipboard.writeText(`Template: ${detail.template.code} (${detail.template.id})\nVersion: ${detail.selected_version.version} (${detail.selected_version.id})`);
      if (mounted.current) setNotice({ error: false, text: zh ? "模板与所选版本 ID 已复制，可在 Expert 中指定复用。" : "Template and selected version IDs copied for Expert reuse." });
    } catch {
      if (mounted.current) setNotice({ error: true, text: zh ? "复制失败，请手动选择 ID 复制。" : "Copy failed. Select and copy the IDs manually." });
    } finally { if (mounted.current) setCopying(false); }
  }
  const selectedEntry = detail?.versions.find(v => v.id === detail.selected_version.id);
  const mediaBase = selectedEntry ? `/api/account/video-jobs/${encodeURIComponent(selectedEntry.source_job_id)}/media` : null;
  const busy = loading || mutating || unavailable;
  return <section id="video-templates" aria-labelledby="video-templates-heading" className="mt-8 border-b border-[var(--color-border)] pb-10">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 id="video-templates-heading" className="text-xl font-semibold">{zh ? "私人复刻模板" : "Private video templates"}</h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{zh ? "按编号和版本查看复刻模板，管理名称、分类及归档状态。" : "Find templates by code and version, and manage names, categories and archive status."}</p></div>
      <button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={busy} onClick={() => { setNotice(null); void load(pageRef.current); }}>{loading ? (zh ? "刷新中…" : "Refreshing…") : (zh ? "刷新模板" : "Refresh templates")}</button>
    </div>
    {notice && view === null && <p role={notice.error ? "alert" : "status"} className={`mt-4 text-sm ${notice.error ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>{notice.text}</p>}
    {readError && <p role="alert" className="mt-4 text-sm text-[var(--color-danger)]">{data ? (zh ? "无法刷新模板，仍显示上次结果；数据可能已过时。" : "Could not refresh templates. Last results remain visible and may be out of date.") : (zh ? "无法加载模板，请重试。" : "Could not load templates. Please retry.")}</p>}
    <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label={zh ? "筛选模板" : "Filter templates"}>{filters.map(([filter, cn, en]) => <button key={filter} type="button" aria-pressed={page.filter === filter} className={`btn ${page.filter === filter ? "btn-primary" : "btn-outline"} !min-h-0 !px-4 !py-2`} disabled={busy} onClick={() => move({ filter, cursors: [null], index: 0 })}>{zh ? cn : en}</button>)}</div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-busy={loading}>
      {!data && loading && <p role="status" className="surface p-6 text-sm">{zh ? "正在加载模板…" : "Loading templates…"}</p>}
      {data && data.templates.length === 0 && <p className="surface p-6 text-sm text-[var(--color-muted)]">{zh ? "此分类暂无模板。" : "No templates in this view."}</p>}
      {data?.templates.map(item => <article key={item.id} className="surface min-w-0 p-5">
        {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" className="mb-4 aspect-video w-full rounded-lg object-cover" /> : <div className="mb-4 flex aspect-video items-center justify-center rounded-lg bg-[var(--color-raised)] text-xs text-[var(--color-muted)]">{zh ? "暂无缩略图" : "No thumbnail"}</div>}
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="break-words font-semibold [overflow-wrap:anywhere]">{item.name}</h3><code className="rounded bg-[var(--color-raised)] px-2 py-1 text-xs">{item.code}</code></div>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{item.category || (zh ? "未分类" : "Uncategorized")} · {zh ? `${item.version_count} 个版本` : `${item.version_count} version${item.version_count === 1 ? "" : "s"}`} · {item.archived ? (zh ? "已归档" : "Archived") : (zh ? "私人" : "Private")}</p>
        <button type="button" className="btn btn-outline mt-4 !min-h-0 !py-2" disabled={busy} onClick={() => open(item)}>{zh ? "查看版本" : "View versions"}</button>
      </article>)}
    </div>
    {data && <div className="mt-5 flex items-center justify-between gap-3"><button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={busy || page.index === 0} onClick={() => move({ ...page, index: page.index - 1 })}>{zh ? "上一页" : "Previous page"}</button><span className="text-xs text-[var(--color-muted)]">{zh ? `第 ${page.index + 1} 页` : `Page ${page.index + 1}`}</span><button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={busy || data.next_cursor === null} onClick={() => { if (data.next_cursor) move({ ...page, cursors: [...page.cursors.slice(0, page.index + 1), data.next_cursor], index: page.index + 1 }); }}>{zh ? "下一页" : "Next page"}</button></div>}
    <Dialog open={view !== null} onClose={close} titleId="video-template-dialog-title">
      <h2 id="video-template-dialog-title" className="text-xl font-semibold">{view === "edit" ? (zh ? "编辑模板信息" : "Edit template details") : view === "archive" ? (detail?.template.archived ? (zh ? "恢复模板？" : "Restore template?") : (zh ? "归档模板？" : "Archive template?")) : (zh ? "模板版本" : "Template versions")}</h2>
      {notice && <p role={notice.error ? "alert" : "status"} className={`mt-4 text-sm ${notice.error ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>{notice.text}</p>}
      {detailLoading && <p role="status" className="mt-4 text-sm">{zh ? "正在读取版本…" : "Loading versions…"}</p>}
      {detailError && <p role="alert" className="mt-4 text-sm text-[var(--color-danger)]">{zh ? "无法读取模板详情，当前显示可能已过时，请重试。" : "Could not load template details. Displayed details may be out of date; please retry."}</p>}
      {(detailError || mediaError) && detailTarget && <button type="button" className="btn btn-outline mt-3" disabled={detailLoading || mutating} onClick={() => void loadDetail(detailTarget.id, detailTarget.versionId)}>{zh ? "重新读取版本" : "Refresh version"}</button>}
      {mediaError && <p role="alert" className="mt-3 text-sm text-[var(--color-warning)]">{zh ? "视频无法加载，请重新读取版本后播放。" : "Video could not be loaded. Refresh the version and try again."}</p>}
      {detail && <>
        <p className="mt-3 break-words font-semibold">{detail.template.name} <code className="text-sm">{detail.template.code}</code></p>
        <code className="mt-1 block break-all text-xs text-[var(--color-muted)]">{detail.template.id}</code>
        {view === "edit" ? <div className="mt-5 space-y-4"><label className="block text-sm">{zh ? "名称" : "Name"}<input name="name" value={name} onChange={event => setName(event.target.value)} className="mt-2 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2" /></label><label className="block text-sm">{zh ? "分类" : "Category"}<input name="category" value={category} onChange={event => setCategory(event.target.value)} className="mt-2 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2" /></label>{formError && <p role="alert" className="text-sm text-[var(--color-danger)]">{formError}</p>}<div className="flex flex-wrap justify-end gap-3"><button type="button" className="btn btn-outline" disabled={mutating} onClick={() => setView("detail")}>{zh ? "取消" : "Cancel"}</button><button type="button" className="btn btn-primary" disabled={mutating} onClick={() => void mutate("edit")}>{zh ? "保存修改" : "Save changes"}</button></div></div>
          : view === "archive" ? <div className="mt-4"><p className="text-sm text-[var(--color-muted)]">{detail.template.archived ? (zh ? "恢复后可在使用中模板中查看。编号与版本不变。" : "Restoring makes this template active again. Its code and versions stay the same.") : (zh ? "归档后将从使用中列表移除。编号与版本保留。" : "Archiving removes it from the active list. Its code and versions remain available.")}</p><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" className="btn btn-outline" disabled={mutating} onClick={() => setView("detail")}>{zh ? "取消" : "Cancel"}</button><button type="button" className="btn btn-outline" disabled={mutating} onClick={() => void mutate("archive")}>{detail.template.archived ? (zh ? "确认恢复" : "Confirm restore") : (zh ? "确认归档" : "Confirm archive")}</button></div></div>
            : <div className="mt-5 space-y-4"><label className="block text-sm">{zh ? "版本" : "Version"}<select value={detail.selected_version.id} disabled={detailLoading || unavailable} onChange={event => void loadDetail(detail.template.id, event.target.value)} className="mt-2 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">{detail.versions.map(v => <option key={v.id} value={v.id}>{zh ? `版本 ${v.version}` : `Version ${v.version}`}</option>)}</select></label><p className="text-sm text-[var(--color-muted)]">{zh ? `当前查看版本 ${detail.selected_version.version}` : `Viewing Version ${detail.selected_version.version}`}</p><code className="block break-all text-xs">{detail.selected_version.id}</code>{(detail.selected_version.character_bindings ?? []).length > 0 && <div className="rounded-lg border border-[var(--color-border)] p-3"><h3 className="text-sm font-semibold">{zh ? "绑定的人物固定版本" : "Bound character versions"}</h3><ul className="mt-2 space-y-2 text-sm">{detail.selected_version.character_bindings.map(binding => <li key={`${binding.segment_index}-${binding.reference_index}`} className="break-words">{binding.code} · {binding.name} · {zh ? `版本 ${binding.version}` : `Version ${binding.version}`} · {zh ? `图片 ${binding.image_index + 1}` : `Image ${binding.image_index + 1}`} <code className="block break-all text-xs text-[var(--color-muted)]">{binding.character_version_id}</code></li>)}</ul></div>}{mediaBase && <div className="grid gap-4 sm:grid-cols-2"><div><p className="mb-2 text-xs text-[var(--color-muted)]">{zh ? "来源视频" : "Source video"}</p><video key={`source-${mediaRevision}`} controls playsInline preload="none" onError={() => setMediaError(true)} src={`${mediaBase}?kind=source`} className="aspect-video w-full rounded-lg bg-black" /></div><div><p className="mb-2 text-xs text-[var(--color-muted)]">{zh ? "满意成片" : "Approved output"}</p><video key={`output-${mediaRevision}`} controls playsInline preload="none" onError={() => setMediaError(true)} src={`${mediaBase}?kind=output`} className="aspect-video w-full rounded-lg bg-black" /></div></div>}<div className="flex flex-wrap gap-2"><button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={copying || unavailable || detailLoading || detailError} onClick={() => void copyIds()}>{zh ? "复制模板及版本 ID" : "Copy IDs for Expert"}</button><button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={unavailable || detailLoading || detailError} onClick={edit}>{zh ? "编辑信息" : "Edit details"}</button><button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={unavailable || detailLoading || detailError} onClick={() => setView("archive")}>{detail.template.archived ? (zh ? "恢复模板" : "Restore template") : (zh ? "归档模板" : "Archive template")}</button></div></div>}
      </>}
      <button type="button" className="btn btn-outline mt-5" disabled={mutating} onClick={close}>{zh ? "关闭" : "Close"}</button>
    </Dialog>
  </section>;
}

