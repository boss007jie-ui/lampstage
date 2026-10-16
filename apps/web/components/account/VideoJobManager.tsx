"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ArrowClockwise } from "@phosphor-icons/react";
import { useLang } from "@/components/i18n/LangProvider";
import { Dialog } from "@/components/ui/Dialog";
import { VideoDeliveryPanel } from "@/components/account/VideoDeliveryPanel";
import type { VideoJobUsage as Usage, VideoJobSummary as Job, VideoJobList as JobList } from "@/lib/video/job-lifecycle";

type Filter = "all" | "draft" | "active" | "history";
type Page = { filter: Filter; cursors: (string | null)[]; index: number };
type Target = { job: Job; action: "cancel" | "close" };
const firstPage: Page = { filter: "all", cursors: [null], index: 0 };
const statusLabels: Record<string, [string, string]> = {
  draft: ["草稿", "Draft"], queued: ["排队中", "Queued"], preparing: ["准备中", "Preparing"],
  review: ["待审阅", "Awaiting review"], generating: ["生成中", "Generating"], assembling: ["合成中", "Assembling"],
  completed: ["已完成", "Completed"], failed: ["失败", "Failed"], attention: ["需要处理", "Needs attention"], cancelled: ["已取消", "Cancelled"],
};
const filters: [Filter, string, string][] = [["all", "全部", "All"], ["draft", "草稿", "Drafts"], ["active", "处理中", "Active"], ["history", "历史", "History"]];

function isUsage(value: unknown): value is Usage {
  const usage = value as Usage | undefined;
  return Boolean(usage && typeof usage.observed_at === "string" && [usage.drafts, usage.active].every(bucket =>
    bucket && [bucket.count, bucket.limit, bucket.remaining].every(n => Number.isInteger(n) && n >= 0)));
}
function isJob(value: unknown): value is Job {
  const job = value as Job | undefined;
  return Boolean(job && typeof job.id === "string" && typeof job.title === "string" && typeof job.status === "string" &&
    typeof job.can_cancel === "boolean" && typeof job.can_close === "boolean" &&
    (job.close_blocked_reason === null || typeof job.close_blocked_reason === "string") &&
    typeof job.counts_toward_limit === "boolean" &&
    ["draft", "active", null].includes(job.quota_bucket) && Number.isInteger(job.revision));
}

export function VideoJobManager({ onSessionExpired, disabled = false, onBusyChange, onTemplateSaved, onCharacterSaved }: {
  onSessionExpired: () => void; disabled?: boolean; onBusyChange: (busy: boolean) => void; onTemplateSaved?: () => void; onCharacterSaved?: () => void;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [data, setData] = useState<JobList | null>(null);
  const [page, setPage] = useState<Page>(firstPage);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const request = useRef(0);
  const expireSession = useRef(onSessionExpired);
  expireSession.current = onSessionExpired;
  const mounted = useRef(false);
  const pending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const date = (value: string | null) => value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(zh ? "zh-CN" : "en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : (zh ? "暂无记录" : "Not recorded");

  const load = useCallback(async (next: Page) => {
    const current = ++request.current;
    setLoading(true); setReadError(false);
    const query = new URLSearchParams({ status: next.filter, limit: "20" });
    const cursor = next.cursors[next.index];
    if (cursor !== null) query.set("cursor", cursor);
    try {
      const response = await fetch(`/api/account/video-jobs?${query}`, { cache: "no-store" });
      if (!mounted.current || request.current !== current) return false;
      if (response.status === 401) { setData(null); expireSession.current(); return false; }
      if (!response.ok) throw new Error("read_failed");
      const body = await response.json();
      if (!mounted.current || request.current !== current) return false;
      if (!Array.isArray(body.jobs) || !body.jobs.every(isJob) || !isUsage(body.usage) ||
        !(body.next_cursor === null || typeof body.next_cursor === "string")) throw new Error("invalid_list");
      setData(body); setPage(next);
      setDeliveryId(current => body.jobs.some((job: Job) => job.id === current) ? current : null);
      return true;
    } catch {
      if (mounted.current && request.current === current) setReadError(true);
      return false;
    } finally {
      if (mounted.current && request.current === current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load(firstPage);
    return () => { mounted.current = false; request.current++; };
  }, [load]);
  useEffect(() => {
    onBusyChange(target !== null || submitting || deliveryBusy);
    return () => onBusyChange(false);
  }, [target, submitting, deliveryBusy, onBusyChange]);

  function closeDialog() { if (!pending.current) setTarget(null); }
  function move(next: Page) {
    if (loading || pending.current || disabled || deliveryBusy) return;
    setNotice(null); void load(next);
  }
  function quotaMessage(bucket: unknown) {
    return bucket === "draft"
      ? (zh ? "云草稿名额已满。请查看草稿，继续已有任务或放弃可取消的草稿。" : "Cloud draft capacity is full. Continue an existing draft or discard an eligible draft.")
      : (zh ? "处理中任务名额已满。请继续已有任务，或关闭不再需要且允许关闭的已停止任务。" : "Your active task capacity is full. Continue an existing task or close an eligible stopped task you no longer need.");
  }
  function blockedReason(job: Job) {
    if (job.status !== "draft") return zh ? "此状态不支持取消。可复制任务 ID，在 Expert 中查询或继续原任务。" : "This status cannot be cancelled. Copy its task ID to check or continue the original task in Expert.";
    const reasons: Record<string, [string, string]> = {
      lease_present: ["任务已被处理程序接管，无法安全取消。", "A worker has claimed this task; it cannot be safely cancelled."],
      state_changed: ["任务已发生变化，请刷新状态。", "The task has changed. Refresh its status."],
      invalid_draft_data: ["任务数据需要核对，暂不自动过期或取消。", "The task data needs checking; automatic expiry and cancellation are unavailable."],
      permit_history: ["任务已有生成历史，无法安全取消。", "Generation history prevents safe cancellation."],
    };
    return reasons[job.cancel_blocked_reason ?? ""]?.[zh ? 0 : 1] ?? (zh ? "无法确认此草稿从未开始处理，暂不自动过期或取消。请在 Expert 中核对原任务。" : "This draft cannot be confirmed as never started. Automatic expiry and cancellation are unavailable; check the original task in Expert.");
  }

  function closeBlockedReason(job: Job) {
    const reasons: Record<string, [string, string]> = {
      not_closable_state: ["当前状态不能关闭，请刷新任务状态。", "This task cannot be closed in its current state. Refresh its status."],
      lease_present: ["任务正被处理程序接管，暂时无法安全关闭。", "A worker currently holds this task, so it cannot be safely closed."],
      invalid_job_data: ["任务数据需要核对，暂时无法安全关闭。", "This task's data needs review before it can be safely closed."],
      unreleased_permit: ["仍有生成请求尚未结束或结果未确认，暂时无法关闭。", "A generation request is still running or its outcome is unconfirmed, so this task cannot be closed yet."],
      unresolved_submission: ["任务仍有待确认的提交，暂时无法关闭。", "A pending submission prevents closing this task."],
      unresolved_image_submission: ["任务仍有待确认的图片提交，暂时无法关闭。", "A pending image submission prevents closing this task."],
    };
    return reasons[job.close_blocked_reason ?? ""]?.[zh ? 0 : 1] ??
      (zh ? "暂时无法安全关闭此任务，请刷新后查看最新状态。" : "This task cannot be safely closed yet. Refresh to check its latest status.");
  }

  async function cancelDraft() {
    if (!target || target.action !== "cancel" || pending.current || disabled) return;
    const job = target.job;
    pending.current = true; setSubmitting(true); setNotice(null);
    try {
      const response = await fetch(`/api/account/video-jobs/${encodeURIComponent(job.id)}/cancel`, { method: "POST" });
      if (!mounted.current) return;
      if (response.status === 401) { setData(null); expireSession.current(); return; }
      const body = await response.json().catch(() => null);
      if (!mounted.current) return;
      setTarget(null);
      if (response.ok && body?.status === "cancelled" && body.id === job.id && isJob(body.job) &&
        body.job.id === job.id && body.job.status === "cancelled" && isUsage(body.usage)) {
        setData(current => current ? { ...current, usage: body.usage, jobs: current.jobs
          .map(item => item.id === job.id ? body.job as Job : item)
          .filter(item => page.filter === "all" || (page.filter === "draft" ? item.quota_bucket === "draft"
            : page.filter === "active" ? item.quota_bucket === "active" : item.quota_bucket === null)) } : current);
        setNotice({ text: zh ? "草稿已放弃。已更新草稿名额，历史记录仍保留。" : "Draft discarded. Draft capacity has been updated; its history is retained.", error: false });
      } else {
        setNotice({ error: true, text: response.status === 409
          ? (zh ? "任务状态已变化或不符合安全取消条件，未确认取消。已重新查询，请按最新状态处理。" : "The task changed or is not safe to cancel. Cancellation was not confirmed; check the refreshed status.")
          : response.status === 404
            ? (zh ? "无法找到此任务，已重新查询列表。" : "This task could not be found. The list has been refreshed.")
            : response.status === 429 ? quotaMessage(body?.quota_bucket)
              : (zh ? "未能确认取消结果，请刷新核对后再操作。" : "We could not confirm cancellation. Refresh and check the task before trying again.") });
      }
      await load(page);
      if (mounted.current) requestAnimationFrame(() => heading.current?.focus());
    } catch {
      if (!mounted.current) return;
      setTarget(null);
      setNotice({ error: true, text: zh ? "网络异常，未能确认取消结果。已尝试重新查询，请核对当前状态；不会自动再次取消。" : "A network error occurred and we could not confirm cancellation. We checked the list again; review its current state before retrying." });
      await load(page);
      if (mounted.current) requestAnimationFrame(() => heading.current?.focus());
    } finally {
      pending.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  async function closeJob() {
    if (!target || target.action !== "close" || pending.current || disabled) return;
    const job = target.job;
    pending.current = true; setSubmitting(true); setNotice(null);
    try {
      const response = await fetch(`/api/account/video-jobs/${encodeURIComponent(job.id)}/close`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_revision: job.revision }),
      });
      if (!mounted.current) return;
      if (response.status === 401) { setData(null); expireSession.current(); return; }
      const body = await response.json().catch(() => null);
      if (!mounted.current) return;
      setTarget(null);
      if (response.ok && body?.status === "cancelled" && body.id === job.id && isJob(body.job) &&
        body.job.id === job.id && body.job.status === "cancelled" && body.job.cancellation_reason === "user_closed" && isUsage(body.usage)) {
        setData(current => current ? { ...current, usage: body.usage, jobs: current.jobs
          .map(item => item.id === job.id ? body.job as Job : item)
          .filter(item => page.filter === "all" || (page.filter === "draft" ? item.quota_bucket === "draft"
            : page.filter === "active" ? item.quota_bucket === "active" : item.quota_bucket === null)) } : current);
        setNotice({ text: zh ? "任务已关闭，历史结果和用量已保留，不退费。" : "Task closed. Its past results and usage remain; there is no refund.", error: false });
      } else {
        setNotice({ error: true, text: response.status === 409
          ? (zh ? "任务状态已变化或不符合安全关闭条件，未确认关闭。已重新查询，请按最新状态处理。" : "The task changed or cannot be safely closed. Closure was not confirmed; check the refreshed status.")
          : response.status === 404
            ? (zh ? "无法找到此任务，已重新查询列表。" : "This task could not be found. The list has been refreshed.")
            : (zh ? "未能确认关闭结果，请刷新核对后再操作。" : "We could not confirm closure. Refresh and check the task before trying again.") });
      }
      await load(page);
      if (mounted.current) requestAnimationFrame(() => heading.current?.focus());
    } catch {
      if (!mounted.current) return;
      setTarget(null);
      setNotice({ error: true, text: zh ? "网络异常，未能确认关闭结果。已尝试重新查询，请核对当前状态；不会自动再次关闭。" : "A network error occurred and we could not confirm closure. We checked the list again; review its current state before retrying." });
      await load(page);
      if (mounted.current) requestAnimationFrame(() => heading.current?.focus());
    } finally {
      pending.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  async function copyId(job: Job) {
    if (copying || pending.current || disabled) return;
    setCopying(job.id); setNotice(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(job.id);
      if (mounted.current) setNotice({ error: false, text: job.cancellation_reason === "user_closed"
        ? (zh ? "任务 ID 已复制，可用于查询历史记录。" : "Task ID copied. Use it to look up the task history.")
        : (zh ? "任务 ID 已复制。在 Expert 中粘贴此 ID，查询或继续原任务。" : "Task ID copied. Paste it into Expert to check or continue the original task.") });
    } catch {
      if (mounted.current) setNotice({ error: true, text: zh ? "复制失败，请手动选择任务 ID 复制。" : "Copy failed. Select the task ID and copy it manually." });
    } finally { if (mounted.current) setCopying(null); }
  }

  const busy = loading || submitting || disabled || deliveryBusy;
  return <section id="video-jobs" aria-labelledby="video-jobs-heading" className="mt-8 border-b border-[var(--color-border)] pb-10">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 ref={heading} tabIndex={-1} id="video-jobs-heading" className="text-xl font-semibold">{zh ? "视频任务" : "Video tasks"}</h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{zh ? "查看自己的云草稿、处理中任务和历史记录。" : "Your cloud drafts, active tasks and history."}</p></div>
      <button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={busy} onClick={() => { setNotice(null); void load(page); }}><ArrowClockwise size={16} />{loading ? (zh ? "刷新中…" : "Refreshing…") : (zh ? "刷新任务" : "Refresh tasks")}</button>
    </div>
    <p className="mt-3 text-sm text-[var(--color-muted)]">{zh ? "草稿与处理中任务分别计算同时数量，不是每天的制作上限。完成、失败或取消的任务保留记录，不占这两类名额。" : "Draft and active limits are separate simultaneous counts, not daily production limits. Completed, failed and cancelled tasks retain their history without using either capacity."}</p>
    {data && <>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {([["draft", data.usage.drafts, zh ? "云草稿" : "Cloud drafts"], ["active", data.usage.active, zh ? "处理中" : "Active tasks"]] as const).map(([bucket, quota, title]) => <div key={bucket} className="surface min-w-0 p-5">
          <h3 className="text-sm text-[var(--color-muted)]">{title}</h3><p className="mt-2 text-2xl font-semibold tabular-nums">{quota.count} / {quota.limit}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{zh ? `剩余 ${quota.remaining} 个名额` : `${quota.remaining} slots remaining`}</p>
          {bucket === "draft" && Number.isFinite(data.usage.drafts.ttl_seconds) && <p className="mt-3 text-xs text-[var(--color-muted)]">{zh
            ? `可安全取消的草稿自创建起保留 ${data.usage.drafts.ttl_seconds / 3600} 小时。`
            : `Eligible drafts expire ${data.usage.drafts.ttl_seconds / 3600} hours after creation.`}</p>}
          {quota.remaining === 0 && <p className="mt-3 text-sm text-[var(--color-warning)]">{quotaMessage(bucket)}</p>}
        </div>)}
      </div>
      <p className="mt-3 text-xs text-[var(--color-muted)]">{zh ? "配额统计于" : "Capacity checked"} {date(data.usage.observed_at)}{readError ? (zh ? " · 数据可能已过时" : " · Data may be out of date") : ""}</p>
    </>}
    {notice && <p role={notice.error ? "alert" : "status"} className={`mt-4 text-sm ${notice.error ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>{notice.text}</p>}
    {readError && <p role="alert" className="mt-4 text-sm text-[var(--color-danger)]">{data
      ? (zh ? "无法刷新任务，仍显示上次成功读取的结果。数据可能已过时，请重试刷新。" : "Could not refresh tasks. The last successful results are still shown and may be out of date. Retry refreshing.")
      : (zh ? "暂时无法加载任务，请重试刷新。API 密钥管理仍可单独使用。" : "Could not load tasks. Retry refreshing; API key management remains available separately.")}</p>}
    <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label={zh ? "筛选视频任务" : "Filter video tasks"}>
      {filters.map(([value, cn, en]) => <button key={value} type="button" aria-pressed={page.filter === value} disabled={busy} className={`btn ${page.filter === value ? "btn-primary" : "btn-outline"} !min-h-0 !px-4 !py-2`} onClick={() => move({ filter: value, cursors: [null], index: 0 })}>{zh ? cn : en}</button>)}
    </div>
    <div aria-busy={loading} className="mt-4 space-y-3">
      {!data && loading && <p role="status" className="surface p-6 text-sm">{zh ? "正在加载任务…" : "Loading tasks…"}</p>}
      {data?.jobs.length === 0 && <p className="surface p-6 text-sm text-[var(--color-muted)]">{zh ? "此分类暂无任务。新任务提交后会显示在这里。" : "No tasks in this view. Submitted tasks will appear here."}</p>}
      {data?.jobs.map(job => <article key={job.id} className="surface min-w-0 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><h3 className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">{job.title || (zh ? "未命名任务" : "Untitled task")}</h3>
          <span className="rounded-full bg-[var(--color-raised)] px-3 py-1 text-xs text-[var(--color-body)]">{job.cancellation_reason === "user_closed" ? (zh ? "已关闭" : "Closed") : statusLabels[job.status]?.[zh ? 0 : 1] ?? (zh ? "状态待核对" : "Status unavailable")}</span></div>
        <p className="mt-2 text-xs text-[var(--color-muted)]">{job.quota_bucket === "draft" ? (zh ? "占用草稿名额" : "Uses draft capacity") : job.quota_bucket === "active" ? (zh ? "占用处理中名额" : "Uses active capacity") : (zh ? "不占用任务名额" : "Uses no task capacity")}</p>
        {job.stage && <p className="mt-2 break-words text-sm text-[var(--color-body)] [overflow-wrap:anywhere]">{job.stage}</p>}
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-[var(--color-muted)] sm:grid-cols-2">
          <div><dt>{zh ? "创建时间" : "Created"}</dt><dd className="mt-1">{date(job.created_at)}</dd></div>
          <div><dt>{zh ? "最近业务进展" : "Last progress"}</dt><dd className="mt-1">{date(job.progress_updated_at)}</dd></div>
          {job.draft_expires_at && job.status === "draft" && <div className="sm:col-span-2"><dt>{zh ? "草稿到期时间" : "Expires"}</dt><dd className="mt-1">{date(job.draft_expires_at)}{Date.parse(job.draft_expires_at) <= Date.now() ? (zh ? " · 已到期，等待系统回收；以刷新后的状态为准" : " · Expiry due; awaiting cleanup. Refresh to check its status.") : (zh ? " · 到期后自动取消，保留历史" : " · Automatically cancelled after expiry; history retained")}</dd></div>}
          {job.status === "cancelled" && <div className="sm:col-span-2"><dt>{job.cancellation_reason === "draft_expired" ? (zh ? "草稿已过期" : "Draft expired") : job.cancellation_reason === "user_cancelled" ? (zh ? "你已取消" : "Cancelled by you") : job.cancellation_reason === "user_closed" ? (zh ? "已关闭" : "Closed") : (zh ? "已取消" : "Cancelled")}</dt><dd className="mt-1">{date(job.cancelled_at)}</dd></div>}
        </dl>
        <div className="mt-4 rounded-lg bg-[var(--color-bg)] p-3"><p className="text-xs text-[var(--color-muted)]">{zh ? "任务 ID" : "Task ID"}</p><code className="mt-1 block break-all text-xs">{job.id}</code></div>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={busy || copying !== null} onClick={() => void copyId(job)}><Copy size={16} />{copying === job.id ? (zh ? "复制中…" : "Copying…") : (zh ? "复制任务 ID" : "Copy task ID")}</button>
          <button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={busy} aria-expanded={deliveryId === job.id} aria-controls={`delivery-${job.id}`} onClick={() => setDeliveryId(current => current === job.id ? null : job.id)}>{deliveryId === job.id ? (zh ? "收起成果" : "Hide results") : (zh ? "查看成果" : "View results")}</button>
          {job.can_cancel && <button type="button" className="btn btn-outline !min-h-0 !py-2 !text-[var(--color-danger)]" disabled={busy} onClick={() => { setNotice(null); setTarget({ job, action: "cancel" }); }}>{zh ? "放弃草稿" : "Discard draft"}</button>}
          {(job.status === "review" || job.status === "attention") && job.can_close && <button type="button" className="btn btn-outline !min-h-0 !py-2 !text-[var(--color-danger)]" disabled={busy} onClick={() => { setNotice(null); setTarget({ job, action: "close" }); }}>{zh ? "关闭任务" : "Close task"}</button>}</div>
        {job.can_cancel ? <p className="mt-3 text-xs text-[var(--color-muted)]">{zh ? "复制任务 ID，在 Expert 中继续此任务；无需重新建单。" : "Copy the task ID to continue this task in Expert without creating another."}</p>
          : (job.status === "review" || job.status === "attention") ? <p className="mt-3 text-xs text-[var(--color-muted)]">{job.can_close
            ? (zh ? "可在 Expert 中继续此任务，也可关闭并保留历史结果和用量。" : "Continue this task in Expert or close it while keeping past results and usage.")
            : closeBlockedReason(job)}</p>
            : job.quota_bucket !== null && <p className="mt-3 text-xs text-[var(--color-muted)]">{blockedReason(job)}</p>}
        {job.cancellation_reason === "user_closed" && <p className="mt-3 text-xs text-[var(--color-muted)]">{zh ? "此任务已关闭，历史结果和用量仍可查看。" : "This task is closed. Its past results and usage remain available."}</p>}
        {deliveryId === job.id && <div id={`delivery-${job.id}`}><VideoDeliveryPanel key={job.id} jobId={job.id} onSessionExpired={onSessionExpired} onBusyChange={setDeliveryBusy} onTemplateSaved={onTemplateSaved} onCharacterSaved={onCharacterSaved} disabled={disabled || submitting || target !== null} /></div>}
      </article>)}
    </div>
    {data && <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={busy || page.index === 0} onClick={() => move({ ...page, index: page.index - 1 })}>{zh ? "上一页" : "Previous page"}</button>
      <span className="text-xs text-[var(--color-muted)]">{zh ? `第 ${page.index + 1} 页` : `Page ${page.index + 1}`}</span>
      <button type="button" className="btn btn-outline !min-h-0 !py-2" disabled={busy || data.next_cursor === null} onClick={() => { if (data.next_cursor !== null) move({ ...page, cursors: [...page.cursors.slice(0, page.index + 1), data.next_cursor], index: page.index + 1 }); }}>{zh ? "下一页" : "Next page"}</button></div>}
    <Dialog open={target !== null} onClose={closeDialog} titleId="video-job-action-title">
      <h2 id="video-job-action-title" className="text-xl font-semibold">{target?.action === "close" ? (zh ? "关闭这个任务？" : "Close this task?") : (zh ? "放弃这个草稿？" : "Discard this draft?")}</h2>
      <p className="mt-4 break-words font-semibold [overflow-wrap:anywhere]">{target?.job.title}</p><code className="mt-2 block break-all text-xs text-[var(--color-muted)]">{target?.job.id}</code>
      <p className="mt-4 text-sm text-[var(--color-muted)]">{target?.action === "close"
        ? (zh ? "确认后此任务将不再继续，历史结果和已产生的用量会保留，不退费。" : "This task will stop and cannot be continued. Past results and usage remain, and there is no refund.")
        : (zh ? "确认后将取消此云草稿，保留历史记录，只释放草稿名额。此任务将不能继续提交；不会删除素材或停止其他正在处理的任务。" : "This cancels the cloud draft and retains its history. Only draft capacity is released. This task can no longer be submitted; media and other active tasks are unaffected.")}</p>
      <div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" className="btn btn-outline" disabled={submitting} onClick={closeDialog}>{target?.action === "close" ? (zh ? "暂不关闭" : "Keep task") : (zh ? "保留草稿" : "Keep draft")}</button>
        <button type="button" className="btn btn-outline !border-[var(--color-danger-border)] !text-[var(--color-danger)]" disabled={submitting} aria-busy={submitting} onClick={() => void (target?.action === "close" ? closeJob() : cancelDraft())}>{submitting
          ? (target?.action === "close" ? (zh ? "关闭中…" : "Closing…") : (zh ? "取消中…" : "Discarding…"))
          : (target?.action === "close" ? (zh ? "确认关闭" : "Confirm close") : (zh ? "确认放弃" : "Confirm discard"))}</button></div>
    </Dialog>
  </section>;
}
