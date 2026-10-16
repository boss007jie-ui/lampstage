"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/components/i18n/LangProvider";
import { Dialog } from "@/components/ui/Dialog";
import type { VideoDelivery, VideoDeliveryMedia, VideoFeedbackDecision, VideoTemplateSummary } from "@/lib/video/template-contracts";
import type { CharacterSaveResponse } from "@/lib/characters/contracts";
import { CharacterSaveDialog } from "./CharacterSaveDialog";
import { characterSavedMessage, isCharacterReference } from "./character-ui";

type Feedback = NonNullable<VideoDelivery["feedback"]>;
type Form = { decision: VideoFeedbackDecision; hash: string };
const decisions: [VideoFeedbackDecision, string, string][] = [
  ["satisfied_save_template", "满意，保存模板", "Satisfied · save template"],
  ["satisfied", "满意", "Satisfied"], ["needs_changes", "需要修改", "Needs changes"],
];
function isFeedback(value: unknown): value is Feedback {
  const v = value as Feedback | null;
  return Boolean(v && decisions.some(([decision]) => decision === v.decision) && typeof v.notes === "string" &&
    [v.template_id, v.template_version_id].every(id => id === null || typeof id === "string"));
}
function isDelivery(value: unknown, jobId: string): value is VideoDelivery {
  const v = value as VideoDelivery | null;
  return Boolean(v && v.job_id === jobId && typeof v.title === "string" && typeof v.can_feedback === "boolean" &&
    typeof v.template_save_supported === "boolean" && v.source && typeof v.source.url === "string" &&
    (v.output_sha256 === null || typeof v.output_sha256 === "string") &&
    (v.output === null || (v.output && typeof v.output.url === "string" && typeof v.output.sha256 === "string")) &&
    Array.isArray(v.segments) && v.segments.every(s => s && Number.isInteger(s.index) && typeof s.accepted === "boolean" && (s.url === null || typeof s.url === "string")) &&
    (v.feedback === null || isFeedback(v.feedback)) &&
    (v.character_references === undefined || (Array.isArray(v.character_references) && v.character_references.every(isCharacterReference))));
}

export function VideoDeliveryPanel({ jobId, onSessionExpired, onBusyChange, onTemplateSaved, onCharacterSaved, disabled = false }: {
  jobId: string; onSessionExpired: () => void; onBusyChange: (busy: boolean) => void; onTemplateSaved?: () => void; onCharacterSaved?: () => void; disabled?: boolean;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [data, setData] = useState<VideoDelivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [mediaRevision, setMediaRevision] = useState(0);
  const [form, setForm] = useState<Form | null>(null);
  const [characterEditor, setCharacterEditor] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [saveMode, setSaveMode] = useState<"new" | "version">("new");
  const [templateId, setTemplateId] = useState("");
  const [templates, setTemplates] = useState<VideoTemplateSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const mounted = useRef(false), request = useRef(0), templateRequest = useRef(0), pending = useRef(false);
  const callbacks = useRef({ onSessionExpired, onBusyChange, onTemplateSaved, onCharacterSaved });
  callbacks.current = { onSessionExpired, onBusyChange, onTemplateSaved, onCharacterSaved };
  const mediaBase = `/api/account/video-jobs/${encodeURIComponent(jobId)}/media`;
  const expire = useCallback(() => {
    request.current++; templateRequest.current++;
    setData(null); setForm(null); setCharacterEditor(false); setTemplates([]); setNotice(null); setLoading(false); setTemplatesLoading(false);
    callbacks.current.onSessionExpired();
  }, []);
  const load = useCallback(async () => {
    const sequence = ++request.current;
    setLoading(true); setReadError(false);
    try {
      const response = await fetch(`/api/account/video-jobs/${encodeURIComponent(jobId)}/delivery`, { cache: "no-store" });
      if (!mounted.current || sequence !== request.current) return;
      if (response.status === 401) { expire(); return; }
      if (!response.ok) throw Error("read_failed");
      const body: unknown = await response.json();
      if (!mounted.current || sequence !== request.current) return;
      if (!isDelivery(body, jobId)) throw Error("invalid_delivery");
      setData(body); setMediaError(false); setMediaRevision(value => value + 1);
      return body;
    } catch { if (mounted.current && sequence === request.current) setReadError(true); }
    finally { if (mounted.current && sequence === request.current) setLoading(false); }
  }, [jobId, expire]);
  useEffect(() => {
    mounted.current = true; setData(null); setForm(null); setNotice(null); void load();
    return () => { mounted.current = false; request.current++; templateRequest.current++; };
  }, [load]);
  useEffect(() => { callbacks.current.onBusyChange(form !== null || characterEditor || submitting); }, [form, characterEditor, submitting]);
  useEffect(() => () => callbacks.current.onBusyChange(false), []);

  async function loadTemplates(cursor: string | null = null) {
    const sequence = ++templateRequest.current;
    setTemplatesLoading(true); setTemplatesError(false);
    const query = new URLSearchParams({ status: "active", limit: "20" });
    if (data?.source.sha256) query.set("source_sha256", data.source.sha256);
    if (cursor) query.set("cursor", cursor);
    try {
      const response = await fetch(`/api/account/video-templates?${query}`, { cache: "no-store" });
      if (!mounted.current || sequence !== templateRequest.current) return;
      if (response.status === 401) { expire(); return; }
      if (!response.ok) throw Error("templates_failed");
      const body = await response.json();
      if (!mounted.current || sequence !== templateRequest.current) return;
      if (!Array.isArray(body.templates) || !body.templates.every((item: VideoTemplateSummary) => item && typeof item.id === "string" && typeof item.code === "string" && typeof item.name === "string" && item.archived === false) ||
        !(body.next_cursor === null || typeof body.next_cursor === "string")) throw Error("invalid_templates");
      setTemplates(current => cursor ? [...current, ...body.templates.filter((item: VideoTemplateSummary) => !current.some(previous => previous.id === item.id))] : body.templates);
      setNextCursor(body.next_cursor);
    } catch { if (mounted.current && sequence === templateRequest.current) setTemplatesError(true); }
    finally { if (mounted.current && sequence === templateRequest.current) setTemplatesLoading(false); }
  }
  const canFeedback = Boolean(data?.can_feedback && data.output && data.output_sha256 && data.output.sha256 === data.output_sha256 && !loading && !readError);
  function open(decision: VideoFeedbackDecision) {
    if (!canFeedback || !data?.output_sha256 || disabled || pending.current ||
      (decision === "satisfied_save_template" && (!data.template_save_supported || data.feedback?.template_id))) return;
    setForm({ decision, hash: data.output_sha256 }); setNotes(data.feedback?.notes ?? "");
    setName(""); setCategory(""); setSaveMode("new"); setTemplateId(""); setTemplates([]); setNextCursor(null);
    setFormError(""); setNotice(null);
    if (decision === "satisfied_save_template") void loadTemplates();
  }
  function close() {
    if (pending.current) return;
    templateRequest.current++; setForm(null); setTemplatesLoading(false); setFormError("");
  }
  async function submit() {
    if (!form || !data || pending.current || disabled || !canFeedback) return;
    if (notes.length > 2000) { setFormError(zh ? "备注最多 2000 个字符。" : "Notes may be up to 2000 characters."); return; }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(notes) || /[\u0000-\u001f\u007f]/.test(name + category)) { setFormError(zh ? "输入含不支持的控制字符，请移除后重试。" : "Remove unsupported control characters before submitting."); return; }
    const save = form.decision === "satisfied_save_template";
    if (save && saveMode === "new" && (name.length > 80 || category.length > 40)) {
      setFormError(zh ? "名称需为 1–80 个字符（可留空自动命名），分类最多 40 个字符。" : "Name must be 1–80 characters, or empty for an automatic name; category may be up to 40 characters."); return;
    }
    if (save && saveMode === "version" && (!templateId || !templates.some(item => item.id === templateId))) {
      setFormError(zh ? "请选择要添加版本的模板。" : "Choose a template for the new version."); return;
    }
    if (form.hash !== data.output_sha256) { close(); setNotice({ error: true, text: zh ? "成片已变化，请重新查看后反馈。" : "The output changed. Review the current video before submitting feedback." }); return; }
    const body = { decision: form.decision, output_sha256: form.hash, notes,
      ...(save ? saveMode === "version" ? { template_id: templateId } : { ...(name.trim() ? { name: name.trim() } : {}), category: category.trim() } : {}) };
    pending.current = true; setSubmitting(true); setFormError("");
    try {
      const response = await fetch(`/api/account/video-jobs/${encodeURIComponent(jobId)}/feedback`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!mounted.current) return;
      if (response.status === 401) { expire(); return; }
      const result = await response.json().catch(() => null);
      if (!mounted.current) return;
      setForm(null); templateRequest.current++;
      const saved = result?.template as VideoTemplateSummary | null;
      const valid = response.ok && isFeedback(result?.feedback) && result.feedback.decision === body.decision &&
        (!save || (saved && typeof saved.id === "string" && typeof saved.code === "string" && typeof result.version_id === "string" &&
          saved.id === result.feedback.template_id && result.version_id === result.feedback.template_version_id));
      if (valid) {
        setData(current => current ? { ...current, feedback: result.feedback } : current);
        setNotice({ error: false, text: save && saved ? (zh ? `已保存私人模板 ${saved.code}。` : `Private template ${saved.code} saved.`) : (zh ? "反馈已记录。" : "Feedback recorded.") });
        if (saved) callbacks.current.onTemplateSaved?.();
      } else setNotice({ error: true, text: result?.error === "template_structure_mismatch"
        ? (zh ? "所选模板的来源或分段结构不同，请选择“新建私人模板”后重新提交。" : "The selected template has a different source or segment structure. Choose a new private template and submit again.")
        : result?.error === "source_hash_unavailable"
          ? (zh ? "暂时无法核对来源视频，未确认保存模板。请稍后重试。" : "The source video could not be verified. Template saving was not confirmed; please retry later.")
          : result?.error === "template_mode_unsupported"
            ? (zh ? "此任务的制作方式暂不支持保存模板。仍可选择其他反馈。" : "This workflow cannot be saved as a template yet. You can still choose another feedback option.")
            : response.status === 409
        ? (zh ? "任务或成片已变化，未确认保存。请重新查看当前视频后反馈。" : "The task or output changed; saving was not confirmed. Review the current video before submitting feedback.")
        : response.status === 404 ? (zh ? "找不到任务或模板，请刷新核对。" : "The task or template could not be found. Refresh and check it.")
          : (zh ? "无法确认反馈结果，请核对当前状态后重试。" : "We could not confirm the feedback. Check the current state before trying again.") });
      const refreshed = await load();
      if (!valid && refreshed?.feedback?.template_id) callbacks.current.onTemplateSaved?.();
    } catch {
      if (!mounted.current) return;
      setForm(null); templateRequest.current++;
      setNotice({ error: true, text: zh ? "网络异常，无法确认反馈结果。已重新查询，请核对；不会自动再次提交。" : "A network error occurred and we could not confirm the feedback. We checked again; review the current state before retrying." });
      const refreshed = await load();
      if (refreshed?.feedback?.template_id) callbacks.current.onTemplateSaved?.();
    } finally { pending.current = false; if (mounted.current) { setSubmitting(false); setTemplatesLoading(false); } }
  }
  function metadata(media: VideoDeliveryMedia | null) {
    if (!media) return zh ? "媒体信息暂不可用" : "Media details unavailable";
    return `${Number.isFinite(media.duration) ? `${media.duration.toFixed(1)}s` : "—"} · ${media.width} × ${media.height}${media.fps ? ` · ${media.fps} fps` : ""}`;
  }
  const locked = disabled || submitting || form !== null || characterEditor;
  const feedbackLabel = decisions.find(([decision]) => decision === data?.feedback?.decision)?.[zh ? 1 : 2];
  return <div className="mt-6 min-w-0 border-t border-[var(--color-border)] pt-5" aria-label={zh ? "视频成果" : "Video results"}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold">{zh ? "视频成果" : "Video results"}</h4><button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={loading || locked} onClick={() => void load()}>{loading ? (zh ? "刷新中…" : "Refreshing…") : (zh ? "刷新成果" : "Refresh results")}</button></div>
    {notice && <p role={notice.error ? "alert" : "status"} className={`mt-4 text-sm ${notice.error ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>{notice.text}</p>}
    {readError && <p role="alert" className="mt-4 text-sm text-[var(--color-danger)]">{data ? (zh ? "无法刷新成果，当前数据可能已过时；请刷新后再反馈。" : "Could not refresh results. Data may be out of date; refresh before giving feedback.") : (zh ? "无法加载成果，请重试刷新。" : "Could not load results. Please refresh to retry.")}</p>}
    {mediaError && <p role="alert" className="mt-4 text-sm text-[var(--color-warning)]">{zh ? "视频暂时无法加载，请点击“刷新成果”后重试播放。" : "A video could not be loaded. Refresh results and try playing it again."}</p>}
    {!data && loading && <p role="status" className="mt-4 text-sm">{zh ? "正在加载成果…" : "Loading results…"}</p>}
    {data && <>
      <div className="mt-4 grid min-w-0 gap-5 sm:grid-cols-2">
        <div className="min-w-0"><h5 className="mb-2 text-sm font-semibold">{zh ? "完整成片" : "Complete video"}</h5>{data.output ? <><video key={`output-${mediaRevision}`} aria-label={zh ? "完整成片" : "Complete video"} controls playsInline preload="none" src={`${mediaBase}?kind=output`} onError={() => setMediaError(true)} className="aspect-video w-full rounded-lg bg-black" /><p className="mt-2 text-xs text-[var(--color-muted)]">{metadata(data.output.media)}</p><a className="btn btn-outline mt-3 !min-h-0 !py-2" href={`${mediaBase}?kind=output&download=1`}>{zh ? "下载完整成片" : "Download complete video"}</a></> : <p className="rounded-lg bg-[var(--color-bg)] p-5 text-sm text-[var(--color-muted)]">{zh ? "暂无完整成片。下方可查看已生成片段。" : "No complete video yet. Available generated segments appear below."}</p>}</div>
        <div className="min-w-0"><h5 className="mb-2 text-sm font-semibold">{zh ? "来源视频" : "Source video"}</h5><video key={`source-${mediaRevision}`} aria-label={zh ? "来源视频" : "Source video"} controls playsInline preload="none" src={`${mediaBase}?kind=source`} onError={() => setMediaError(true)} className="aspect-video w-full rounded-lg bg-black" /></div>
      </div>
      <h5 className="mt-6 text-sm font-semibold">{zh ? "生成片段" : "Generated segments"}</h5><div className="mt-3 grid gap-4 sm:grid-cols-2">{[...data.segments].sort((a, b) => a.index - b.index).map(segment => <div key={segment.index} className="min-w-0 rounded-lg border border-[var(--color-border)] p-3"><p className="mb-2 text-sm">{zh ? `片段 ${segment.index + 1}` : `Segment ${segment.index + 1}`} · {segment.accepted ? (zh ? "已接受" : "Accepted") : (zh ? "待验收" : "Awaiting review")}</p>{segment.url ? <><video key={`segment-${segment.index}-${mediaRevision}`} aria-label={zh ? `片段 ${segment.index + 1}` : `Segment ${segment.index + 1}`} controls playsInline preload="none" src={`${mediaBase}?kind=candidate&segment=${segment.index}`} onError={() => setMediaError(true)} className="aspect-video w-full rounded-lg bg-black" /><p className="mt-2 text-xs text-[var(--color-muted)]">{metadata(segment.media)}</p><a className="mt-3 inline-block text-sm underline underline-offset-4" href={`${mediaBase}?kind=candidate&segment=${segment.index}&download=1`}>{zh ? "下载此片段" : "Download segment"}</a></> : <p className="text-sm text-[var(--color-muted)]">{zh ? "此片段暂无可播放文件。" : "No playable file for this segment yet."}</p>}</div>)}</div>
      {data.segments.length === 0 && <p className="mt-3 text-sm text-[var(--color-muted)]">{zh ? "暂无生成片段。" : "No generated segments yet."}</p>}
      <div className="mt-6 rounded-lg border border-[var(--color-border)] p-4"><h5 className="font-semibold">{zh ? "保存人物参考" : "Save character references"}</h5><p className="mt-2 text-sm text-[var(--color-muted)]">{zh ? "使用本任务原始人物参考图保存人物，可在其他动作模板中复用。这里的图片不是生成视频的截图；保存人物不会提交反馈或保存模板。" : "Save this job's original character reference images for reuse with other action templates. These are not frames from the generated video; saving a character does not submit feedback or save a template."}</p>
        {(data.character_references ?? []).length > 0 && <div className="mt-3 flex flex-wrap gap-2">{data.character_references.map(reference => <img key={reference.asset_id} src={reference.image_url} alt={reference.label} className="h-16 w-16 rounded object-cover" />)}</div>}
        {(data.character_references ?? []).length === 0 && <p className="mt-2 text-xs text-[var(--color-muted)]">{zh ? "此任务没有可预填的人物参考图，可在保存时选择已有图片或上传。" : "This job has no character references to prefill. Choose an existing image or upload one when saving."}</p>}
        <button type="button" className="btn btn-outline mt-4 !min-h-0 !py-2" disabled={locked || loading || readError} onClick={() => { setNotice(null); setCharacterEditor(true); }}>{zh ? "保存人物参考" : "Save character references"}</button>
      </div>
      <div className="mt-6 rounded-lg bg-[var(--color-bg)] p-4"><h5 className="font-semibold">{zh ? "这次成片符合预期吗？" : "Does this video meet your expectations?"}</h5><p className="mt-2 text-sm text-[var(--color-muted)]">{zh ? "查看完整视频后选择反馈。只有选择保存，才会加入私人模板。" : "Review the complete video before giving feedback. A private template is created only when you choose to save one."}</p>
        {data.feedback && <div className="mt-3 text-sm"><p>{zh ? "当前反馈：" : "Current feedback: "}{feedbackLabel}</p>{data.feedback.notes && <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{data.feedback.notes}</p>}{data.feedback.template_id && <p className="mt-1 text-[var(--color-muted)]">{zh ? "此成片已保存为模板，保留原模板及版本关联。" : "This output is already saved as a template; its template and version remain linked."}</p>}</div>}
        <div className="mt-4 flex flex-wrap gap-2">{decisions.map(([decision, cn, en]) => <button key={decision} type="button" className={`btn ${decision === "satisfied_save_template" ? "btn-primary" : "btn-outline"} !min-h-0 !py-2`} disabled={!canFeedback || locked || (decision === "satisfied_save_template" && (!data.template_save_supported || Boolean(data.feedback?.template_id)))} onClick={() => open(decision)}>{decision === "satisfied_save_template" && data.feedback?.template_id ? (zh ? "模板已保存" : "Template already saved") : (zh ? cn : en)}</button>)}</div>
        {!data.can_feedback && <p className="mt-3 text-xs text-[var(--color-muted)]">{zh ? "任务完成且所有片段通过验收后，可提交最终反馈。" : "Final feedback becomes available once the task is complete and all segments are accepted."}</p>}{!data.template_save_supported && <p className="mt-3 text-xs text-[var(--color-muted)]">{zh ? "此任务的制作方式暂不支持保存模板。" : "This task's workflow does not support saving templates yet."}</p>}
      </div>
    </>}
    {characterEditor && <CharacterSaveDialog initialReferences={data?.character_references ?? []} onClose={() => setCharacterEditor(false)} onSessionExpired={expire} onRecheck={() => callbacks.current.onCharacterSaved?.()} onSaved={(result: CharacterSaveResponse) => { if (!mounted.current) return; setCharacterEditor(false); setNotice({ error: false, text: characterSavedMessage(result, zh) }); callbacks.current.onCharacterSaved?.(); }} />}
    <Dialog open={form !== null} onClose={close} titleId={`feedback-title-${jobId}`}>
      <h2 id={`feedback-title-${jobId}`} className="text-xl font-semibold">{decisions.find(([decision]) => decision === form?.decision)?.[zh ? 1 : 2]}</h2>
      {form?.decision === "satisfied_save_template" && <div className="mt-4 space-y-4"><label className="block text-sm">{zh ? "保存方式" : "Save as"}<select name="saveMode" value={saveMode} disabled={submitting} onChange={event => { setSaveMode(event.target.value as "new" | "version"); setFormError(""); }} className="input mt-2 w-full"><option value="new">{zh ? "新建私人模板" : "New private template"}</option><option value="version">{zh ? "已有模板的新版本" : "New version of an existing template"}</option></select></label>
        {saveMode === "new" ? <><label className="block text-sm">{zh ? "名称（选填，留空自动命名）" : "Name (optional, automatic if empty)"}<input name="name" value={name} disabled={submitting} onChange={event => setName(event.target.value)} className="input mt-2 w-full" /></label><label className="block text-sm">{zh ? "分类（选填）" : "Category (optional)"}<input name="category" value={category} disabled={submitting} onChange={event => setCategory(event.target.value)} className="input mt-2 w-full" /></label></>
          : <><label className="block text-sm">{zh ? "选择模板" : "Choose template"}<select name="template_id" value={templateId} disabled={submitting || templatesLoading} onChange={event => { setTemplateId(event.target.value); setFormError(""); }} className="input mt-2 w-full"><option value="">{zh ? "请选择模板编号与名称" : "Select template code and name"}</option>{templates.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><p className="text-xs text-[var(--color-muted)]">{zh ? "新版本须使用相同来源和分段结构；更换结构请新建模板。" : "A new version requires the same source and segment structure. Create a new template for a different structure."}</p>{templatesLoading && <p role="status" className="text-sm">{zh ? "正在加载模板…" : "Loading templates…"}</p>}{templatesError && <p role="alert" className="text-sm text-[var(--color-danger)]">{zh ? "无法加载模板，请重试。" : "Could not load templates. Please retry."}</p>}{!templatesLoading && (templatesError || nextCursor) && <button type="button" className="btn btn-outline" disabled={submitting} onClick={() => void loadTemplates(templatesError ? null : nextCursor)}>{templatesError ? (zh ? "重试加载模板" : "Retry templates") : (zh ? "加载更多模板" : "Load more templates")}</button>}</>}
      </div>}
      <label className="mt-4 block text-sm">{zh ? "反馈备注（选填）" : "Feedback notes (optional)"}<textarea name="notes" rows={3} value={notes} disabled={submitting} onChange={event => setNotes(event.target.value)} className="input mt-2 w-full resize-y" /></label>
      {formError && <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">{formError}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" className="btn btn-outline" disabled={submitting} onClick={close}>{zh ? "返回查看" : "Back to video"}</button><button type="button" className="btn btn-primary" disabled={submitting || disabled} aria-busy={submitting} onClick={() => void submit()}>{submitting ? (zh ? "提交中…" : "Submitting…") : (zh ? "提交反馈" : "Submit feedback")}</button></div>
    </Dialog>
  </div>;
}
