"use client";
/* eslint-disable @next/next/no-img-element -- Local blob previews and server-issued signed frame URLs are not suitable for Next image optimization. */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle, Clock, DownloadSimple, FilmStrip, ImageSquare, Info, SpinnerGap, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import { LoginModal } from "@/components/auth/LoginModal";
import { useLang } from "@/components/i18n/LangProvider";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import type { VideoCapabilities, VideoJobView } from "@/lib/video/types";
import styles from "./video-workspace.module.css";

type ApiError = { error?: string };
type SavedDraft = { projectId: string; source: File; product: File; title: string; instructions: string; preserveAudio: boolean };
const ACTIVE = new Set(["queued", "preparing", "generating", "assembling"]);
const MAX_IMAGE = 5 * 1024 * 1024;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  let body: T & ApiError;
  try { body = await response.json(); } catch { throw new Error(`HTTP ${response.status}`); }
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function errorText(error: unknown) { return error instanceof Error ? error.message : "request_failed"; }
function displayError(error: string, lang: "zh" | "en") {
  return lang === "en" && /[\u3400-\u9fff]/.test(error)
    ? "The video service could not complete this request. Please check the project status and try again if appropriate."
    : error;
}
function capabilityMessage(capabilities: VideoCapabilities, lang: "zh" | "en") {
  if (lang === "zh") return capabilities.reason ?? "配置或权限未就绪";
  if (!capabilities.database_ready) return "The video database is unavailable.";
  if (!capabilities.storage_ready) return "Private video storage is unavailable.";
  if (!capabilities.worker_ready) return "The video processing service is offline.";
  if (!capabilities.image_ready) return "The image preparation service is unavailable.";
  if (!capabilities.video_ready) return "The video rendering service is unavailable.";
  if (capabilities.pricing.per_segment_coins === null) return "The video cost estimate is not configured.";
  return "The video service is unavailable.";
}
function stageText(project: VideoJobView, lang: "zh" | "en") {
  if (lang === "zh") return project.stage;
  const stages: Record<VideoJobView["status"], string> = {
    draft: "Draft project", queued: "Waiting in the queue", preparing: "Preparing reference frames",
    review: "Frames ready for review", generating: "Rendering video segments",
    assembling: "Assembling the final video", completed: "Video complete",
    failed: "Processing failed", attention: "Existing task needs checking",
  };
  return `${stages[project.status]}${project.estimate.segments ? ` · ${project.estimate.segments} segment${project.estimate.segments === 1 ? "" : "s"}` : ""}`;
}
function dateText(value: string, lang: "zh" | "en") {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default function VideoWorkspacePage() {
  const { lang } = useLang();
  const copy = (zh: string, en: string) => lang === "zh" ? zh : en;
  const [capabilities, setCapabilities] = useState<VideoCapabilities | null>(null);
  const [capError, setCapError] = useState<string | null>(null);
  const [projects, setProjects] = useState<VideoJobView[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [selected, setSelected] = useState<VideoJobView | null>(null);
  const selectedId = useRef<string | null>(null);
  const restoreProjectFocus = useRef(false);
  const [source, setSource] = useState<File | null>(null);
  const [product, setProduct] = useState<File | null>(null);
  const [savedDraft, setSavedDraft] = useState<SavedDraft | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [productPreview, setProductPreview] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [metadataError, setMetadataError] = useState(false);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [preserveAudio, setPreserveAudio] = useState(true);
  const [reviewed, setReviewed] = useState(false);
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const operationLock = useRef(false);
  const projectFetches = useRef(new Map<string, Promise<VideoJobView>>());

  const chooseProject = useCallback((project: VideoJobView) => {
    selectedId.current = project.id;
    setSelected(project);
    setSyncError(null);
    const url = new URL(window.location.href);
    url.searchParams.set("project", project.id);
    // Let Next copy its own history fields and sync the canonical URL.
    window.history.replaceState(null, "", url);
    setReviewed(false);
    setBudget(project.estimate.video_coins === null ? "" : String(project.estimate.video_coins));
  }, []);

  const loadCapabilities = useCallback(async () => {
    try { setCapabilities(await json<VideoCapabilities>("/api/videos/capabilities")); setCapError(null); }
    catch (cause) { setCapError(errorText(cause)); }
  }, []);
  const loadProject = useCallback(async (id: string) => {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw new Error("Invalid project link.");
    const existing = projectFetches.current.get(id);
    if (existing) return existing;
    const pending = (async () => {
      const data = await json<{ project: VideoJobView }>(`/api/videos/projects/${id}`);
      if (selectedId.current === id) {
        setSelected(current => !current || current.id !== id || new Date(data.project.updated_at).getTime() >= new Date(current.updated_at).getTime() ? data.project : current);
        setSyncError(null);
        if (data.project.estimate.video_coins !== null) setBudget(current => current || String(data.project.estimate.video_coins));
      }
      setProjects(current => current.map(item => item.id === id && new Date(data.project.updated_at).getTime() >= new Date(item.updated_at).getTime() ? data.project : item));
      return data.project;
    })();
    projectFetches.current.set(id, pending);
    try { return await pending; }
    finally { projectFetches.current.delete(id); }
  }, []);
  const loadProjects = useCallback(async () => {
    try {
      const data = await json<{ projects: VideoJobView[] }>("/api/videos/projects");
      setProjects(data.projects);
      setHistoryError(null);
    } catch (cause) { setHistoryError(errorText(cause)); }
    const id = selectedId.current;
    if (id) await loadProject(id).catch(cause => setSyncError(errorText(cause)));
  }, [loadProject]);

  useEffect(() => {
    selectedId.current = new URL(window.location.href).searchParams.get("project");
    restoreProjectFocus.current = Boolean(selectedId.current);
    void loadCapabilities();
    void loadProjects();
  }, [loadCapabilities, loadProjects]);
  useEffect(() => {
    if (!selected?.id || !restoreProjectFocus.current) return;
    restoreProjectFocus.current = false;
    document.getElementById("video-review-title")?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [selected?.id]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void loadProjects(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [loadProjects]);
  useEffect(() => {
    if (!source) { setSourcePreview(null); return; }
    const url = URL.createObjectURL(source);
    setSourcePreview(url);
    setDuration(null); setDimensions(null); setMetadataError(false);
    return () => URL.revokeObjectURL(url);
  }, [source]);
  useEffect(() => {
    if (!product) { setProductPreview(null); return; }
    const url = URL.createObjectURL(product);
    setProductPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [product]);
  const pollingId = selected && ACTIVE.has(selected.status) ? selected.id : null;
  useEffect(() => {
    if (!pollingId) return;
    const id = pollingId;
    let inFlight = false;
    const interval = window.setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      if (document.visibilityState !== "visible") { inFlight = false; return; }
      void loadProject(id).catch(cause => setSyncError(errorText(cause))).finally(() => { inFlight = false; });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [pollingId, loadProject]);

  const videoValid = Boolean(source && ["video/mp4", "video/quicktime"].includes(source.type) && duration !== null && duration >= 4 && duration <= 15.001 && dimensions && Math.abs(dimensions.width / dimensions.height - 9 / 16) <= 0.025 && dimensions.width >= 144 && dimensions.height <= 8192 && source.size > 0 && source.size <= (capabilities?.limits.max_bytes ?? 150 * 1024 * 1024));
  const productValid = Boolean(product && ["image/jpeg", "image/png", "image/webp"].includes(product.type) && product.size <= MAX_IMAGE);
  const draftTitle = title.trim() || source?.name.replace(/\.[^.]+$/, "").slice(0, 80) || "商品视频";
  const draftInstructions = instructions.trim();
  const draftMatches = Boolean(savedDraft && savedDraft.source === source && savedDraft.product === product && savedDraft.title === draftTitle && savedDraft.instructions === draftInstructions && savedDraft.preserveAudio === preserveAudio);
  const materialsReady = Boolean(capabilities?.signed_in && capabilities.eligible && capabilities.database_ready && capabilities.storage_ready);
  const canSave = Boolean(materialsReady && videoValid && productValid && !busy);
  const preparationReady = Boolean(capabilities?.signed_in && capabilities.eligible && capabilities.database_ready && capabilities.storage_ready && capabilities.worker_ready && capabilities.image_ready);
  const canPrepare = preparationReady && videoValid && productValid && !busy;
  const estimate = selected?.estimate.video_coins;
  const parsedBudget = Number(budget);
  const canRender = capabilities?.ready && capabilities.eligible && selected?.status === "review" && estimate !== null && estimate !== undefined && reviewed && Number.isSafeInteger(parsedBudget) && parsedBudget >= estimate && parsedBudget <= 1000000 && parsedBudget > 0 && !busy;

  async function run(name: string, action: () => Promise<void>) {
    if (operationLock.current) return;
    operationLock.current = true; setBusy(name); setError(null);
    try { await action(); }
    catch (cause) { setError(errorText(cause)); }
    finally { operationLock.current = false; setBusy(null); }
  }
  async function uploadProduct(file: File): Promise<string> {
    const form = new FormData(); form.append("file", file);
    const data = await json<{ id: string }>("/api/uploads", { method: "POST", body: form });
    return data.id;
  }
  async function uploadSource(file: File): Promise<string> {
    const ticket = await json<{ asset_id: string; upload_url: string; headers: Record<string, string> }>("/api/videos/uploads", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, mime: file.type, size: file.size }),
    });
    const result = await fetch(ticket.upload_url, { method: "PUT", headers: ticket.headers, body: file });
    if (!result.ok) throw new Error(`video_upload_failed: HTTP ${result.status}`);
    await json<{ asset_id: string }>(`/api/videos/uploads/${ticket.asset_id}/complete`, { method: "POST" });
    return ticket.asset_id;
  }
  async function saveDraft(sourceFile: File, productFile: File): Promise<VideoJobView> {
    const [sourceId, productId] = await Promise.all([uploadSource(sourceFile), uploadProduct(productFile)]);
    const created = await json<{ project: VideoJobView }>("/api/videos/projects", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_asset_id: sourceId, product_asset_id: productId, title: draftTitle, instructions: draftInstructions, preserve_audio: preserveAudio }),
    });
    setSavedDraft({ projectId: created.project.id, source: sourceFile, product: productFile, title: draftTitle, instructions: draftInstructions, preserveAudio });
    chooseProject(created.project);
    setProjects(current => [created.project, ...current]);
    return created.project;
  }
  function saveMaterials() {
    if (!source || !product || !canSave || draftMatches) return;
    void run("save", async () => { await saveDraft(source, product); await loadProjects(); });
  }
  function prepare() {
    if (!source || !product || !canPrepare) return;
    void run("prepare", async () => {
      const project = draftMatches && savedDraft ? { id: savedDraft.projectId } : await saveDraft(source, product);
      const prepared = await json<{ project: VideoJobView }>(`/api/videos/projects/${project.id}/prepare`, { method: "POST" });
      chooseProject(prepared.project);
      await loadProjects();
    });
  }
  function render() {
    if (!selected || !canRender) return;
    const id = selected.id;
    void run("render", async () => {
      const data = await json<{ project: VideoJobView }>(`/api/videos/projects/${id}/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_references: true, accept_estimate: true, max_coins: parsedBudget }),
      });
      chooseProject(data.project);
      await loadProjects();
    });
  }
  function reconcile() {
    if (!selected) return;
    const id = selected.id;
    void run("reconcile", async () => {
      const data = await json<{ project: VideoJobView }>(`/api/videos/projects/${id}/reconcile`, { method: "POST" });
      chooseProject(data.project);
      await loadProjects();
    });
  }

  return <div className={styles.page}>
    <SiteHeader active="video" />
    <main className={styles.main}>
      <section className={styles.hero}>
        <div><span className={styles.eyebrow}><FilmStrip size={16} /> {copy("内测 · 视频工作台", "BETA · VIDEO STUDIO")}</span>
          <h1>{copy("把参考视频的节奏，带给你的内容。", "Bring the rhythm of a reference video to your content.")}</h1>
          <p>{copy("上传一段参考视频和一份源素材。先核对关键画面，再决定是否生成适配视频。", "Upload a reference video and source asset. Review the key frames before deciding whether to render your adapted video.")}</p>
        </div>
        <div className={styles.heroVisual} aria-hidden="true"><div className={styles.heroFrame}><FilmStrip size={46} weight="thin" /><span>01 / 03</span></div><div className={styles.heroArrow}><ArrowRight size={24} /></div><div className={styles.heroFrame}><ImageSquare size={46} weight="thin" /><span>02 / 03</span></div></div>
      </section>
      <div className={styles.specBar}><span>01 {copy("上传素材", "Upload assets")}</span><ArrowRight size={16} /><span>02 {copy("核对画面", "Review frames")}</span><ArrowRight size={16} /><span>03 {copy("生成视频", "Render video")}</span><strong>9:16 · 768P · 4–15s</strong></div>
      <div className={styles.access} role="status">{!capabilities && !capError ? copy("正在检查内测服务…", "Checking beta service…") : capError ? `${copy("无法检查服务状态：", "Could not check service status: ")}${displayError(capError, lang)}` : capabilities && !capabilities.signed_in ? <>{copy("视频工作台目前仅向受邀账号开放。", "The video studio is currently available to invited accounts.")} <button type="button" onClick={() => setLoginOpen(true)}>{copy("登录", "Sign in")}</button></> : capabilities && !capabilities.eligible ? `${copy("此账号尚未获邀参与视频内测。", "This account is not yet invited to the video beta.")}${lang === "zh" && capabilities.reason ? ` ${capabilities.reason}` : ""}` : capabilities && !capabilities.ready ? `${preparationReady ? copy("可以准备参考画面，视频渲染暂不可用：", "Reference preparation is available. Rendering is unavailable: ") : materialsReady ? copy("可以先保存素材和草稿；准备画面暂不可用：", "You can save materials and a draft; frame preparation is unavailable: ") : copy("暂时无法使用视频服务：", "Video service is currently unavailable: ")}${capabilityMessage(capabilities, lang)}` : copy("内测服务已就绪。", "Beta service is ready.")}</div>

      <div className={styles.grid}>
        <section className={styles.panel} aria-labelledby="video-input-title">
          <div className={styles.panelHead}><span className={styles.step}>01</span><div><h2 id="video-input-title">{copy("准备素材", "Prepare your assets")}</h2><p>{copy("参考镜头的运动与构图，替换为你的素材。", "Use the reference motion and composition with your source asset.")}</p></div></div>
          <div className={styles.uploadGrid}>
            <div className={styles.uploadBox}>
              <label htmlFor="reference-video" className={styles.uploadLabel}><FilmStrip size={23} /><strong>{copy("参考视频", "Reference video")}</strong><span>{copy("MP4/MOV · 4–15 秒 · 竖屏 9:16", "MP4/MOV · 4–15 sec · portrait 9:16")}</span><span className={styles.pick}><UploadSimple size={16} />{source ? copy("更换视频", "Replace video") : copy("选择视频", "Choose video")}</span></label>
              <input id="reference-video" className={styles.fileInput} type="file" accept="video/mp4,video/quicktime" disabled={Boolean(busy)} onChange={event => { setSource(event.target.files?.[0] ?? null); setSavedDraft(null); }} />
              {sourcePreview && <video className={styles.localVideo} src={sourcePreview} controls playsInline preload="metadata" aria-label={copy("参考视频预览，可使用播放器控制声音", "Reference video preview; use the player controls for audio if present")} onLoadedMetadata={event => { const element = event.currentTarget; setDuration(element.duration); setDimensions({ width: element.videoWidth, height: element.videoHeight }); }} onError={() => setMetadataError(true)} />}
              {source && <p className={styles.fileName}>{source.name}</p>}
              {metadataError && <p className={styles.validation}>{copy("无法读取视频，请换一个 MP4 或 MOV 文件。", "Could not read the video. Try another MP4 or MOV file.")}</p>}
              {source && duration !== null && <p className={videoValid ? styles.fileMeta : styles.validation}>{duration.toFixed(1)}s · {dimensions?.width}×{dimensions?.height}{!videoValid && ` · ${copy("需要 4–15 秒、9:16 竖屏视频（宽至少 144px）", "Needs a 4–15 sec 9:16 portrait video (at least 144px wide)")}`}</p>}
              {source && source.size > (capabilities?.limits.max_bytes ?? 150 * 1024 * 1024) && <p className={styles.validation}>{copy("视频文件过大。", "Video file is too large.")}</p>}
            </div>
            <div className={styles.uploadBox}>
              <label htmlFor="product-image" className={styles.uploadLabel}><ImageSquare size={23} /><strong>{copy("源图片", "Source image")}</strong><span>{copy("清晰源图 · JPG/PNG/WebP · 最多 5 MB", "Clear source image · JPG/PNG/WebP · up to 5 MB")}</span><span className={styles.pick}><UploadSimple size={16} />{product ? copy("更换图片", "Replace image") : copy("选择图片", "Choose image")}</span></label>
              <input id="product-image" className={styles.fileInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy)} onChange={event => { setProduct(event.target.files?.[0] ?? null); setSavedDraft(null); }} />
              {productPreview && <div className={styles.localImage}><img src={productPreview} alt={copy("选中的源图", "Selected source image")} /></div>}
              {product && <p className={styles.fileName}>{product.name}</p>}
              {product && !productValid && <p className={styles.validation}>{copy("请使用 5 MB 内的 JPG、PNG 或 WebP。", "Use a JPG, PNG or WebP under 5 MB.")}</p>}
            </div>
          </div>
          <div className={styles.fields}><label>{copy("项目名称", "Project name")}<input value={title} maxLength={80} onChange={event => setTitle(event.target.value)} placeholder={copy("例如：春季新品短片", "e.g. Spring product film")} disabled={Boolean(busy)} /></label><label>{copy("创作补充", "Creative notes")}<textarea value={instructions} maxLength={1000} onChange={event => setInstructions(event.target.value)} placeholder={copy("告诉我们需要保留的主体特征或氛围", "Describe subject details or the mood to preserve")} disabled={Boolean(busy)} /></label><label className={styles.checkbox}><input type="checkbox" checked={preserveAudio} onChange={event => setPreserveAudio(event.target.checked)} disabled={Boolean(busy)} />{copy("尽量保留参考视频的声音", "Preserve reference audio where possible")}</label></div>
          <div className={styles.actionRow}><div className={styles.betaNote}><Info size={18} /><span>{copy("保存素材只建立草稿；准备关键画面会调用图像服务，费用由内测账号承担，不会扣除你的图片额度。", "Saving materials creates a draft only. Preparing key frames uses the image service, paid by the beta account, without charging your image credits.")}</span></div><div className={styles.actionButtons}><button className={styles.secondary} type="button" onClick={saveMaterials} disabled={!canSave || draftMatches}>{busy === "save" ? <SpinnerGap size={18} className={styles.spin} /> : <UploadSimple size={18} />}{draftMatches ? copy("素材已保存", "Materials saved") : copy("保存素材为草稿", "Save materials as draft")}</button><button className={styles.primary} type="button" onClick={prepare} disabled={!canPrepare}>{busy === "prepare" ? <SpinnerGap size={18} className={styles.spin} /> : <ArrowRight size={18} />}{copy("准备并查看画面", "Prepare and review frames")}</button></div>{draftMatches && <p className={styles.savedHint} role="status">{copy("素材已保存到最近项目。修改文件或项目内容后需要保存新草稿。", "Materials are saved in Recent projects. Changing files or project details requires a new draft.")}</p>}</div>
        </section>

        <section className={styles.panel} aria-labelledby="video-review-title">
          <div className={styles.panelHead}><span className={styles.step}>02</span><div><h2 id="video-review-title">{copy("核对与生成", "Review and render")}</h2><p>{copy("确认素材呈现符合预期，再提交视频生成。", "Confirm the source asset looks right before submitting the render.")}</p></div></div>
          {!selected ? <><div className={styles.empty}><div className={styles.emptyIcon}><FilmStrip size={38} weight="thin" /></div><h3>{copy("画面会显示在这里", "Your key frames appear here")}</h3><p>{copy("准备素材后，可核对每段的开头和结尾画面。", "After preparation, review each segment’s opening and ending frame.")}</p></div>{syncError && <p className={styles.validation} role="alert">{copy("无法打开所选项目，请确认已登录后重试：", "Could not open the selected project. Sign in and try again: ")}{displayError(syncError, lang)}</p>}</> : <>
            <div className={styles.projectHeadline}><div><strong>{selected.title}</strong><span>{stageText(selected, lang)} · {dateText(selected.updated_at, lang)}</span></div><Status status={selected.status} lang={lang} /></div>
            {ACTIVE.has(selected.status) && <div className={styles.progressCard} role="status" aria-live="polite">
              <div className={styles.progressHeading}><SpinnerGap size={20} className={styles.spin} aria-hidden="true" /><div><strong>{copy("视频任务正在后台处理", "Your video is processing")}</strong><p>{lang === "zh" ? selected.stage : stageText(selected, lang)}</p></div></div>
              <div className={styles.progressFacts}><span>{copy("最近更新", "Last updated")}：{dateText(selected.updated_at, lang)}</span>{selected.segments.length > 0 && <span>{copy("已保存片段", "Saved segments")}：{selected.segments.filter(segment => segment.candidate_url).length} / {selected.segments.length}</span>}</div>
              <p>{copy("可离开本页，稍后从最近项目继续查看。画面与已完成的片段会在下方出现。", "You can leave this page and return through Recent projects. Frames and saved segments appear below as they become available.")}</p>
              <Link className={styles.secondary} href="/workspace">{copy("继续制作图片", "Keep working on images")}<ArrowRight size={17} /></Link>
            </div>}
            {syncError && <div className={styles.syncNotice} role="status"><WarningCircle size={18} /><span>{copy("暂时无法同步最新进度；后台任务可能仍在运行。", "Could not refresh the latest status. Processing may still be running.")} {displayError(syncError, lang)}</span><button type="button" onClick={() => void loadProject(selected.id).catch(cause => setSyncError(errorText(cause)))}>{copy("重试查询", "Check again")}</button></div>}
            {selected.status === "completed" && <div className={styles.completeCallout} role="status"><CheckCircle size={24} /><div><strong>{copy("视频已完成", "Your video is ready")}</strong><p>{copy("可在下方预览并下载完整视频。", "Preview and download the finished video below.")}</p></div><a href="#video-result">{copy("查看成片", "View video")}<ArrowRight size={17} /></a></div>}
            <details className={styles.projectAssets}><summary>{copy("查看本项目的参考视频与源图", "View this project's reference video and source image")}</summary><div className={styles.framePair}><video src={selected.source_url} controls playsInline preload="metadata" aria-label={copy("本项目参考视频", "Project reference video")} /><img src={selected.product_url} alt={copy("本项目源图", "Project source image")} /></div></details>
            {selected.segments.some(segment => segment.candidate_url) && <details className={styles.projectAssets}><summary>{copy("查看已生成的片段", "View generated segments")}</summary>{selected.segments.filter(segment => segment.candidate_url).map(segment => <div key={segment.index}><p>{copy(`片段 ${segment.index + 1}`, `Segment ${segment.index + 1}`)}</p><video src={segment.candidate_url!} controls playsInline preload="metadata" aria-label={copy(`第 ${segment.index + 1} 段候选视频`, `Candidate video for segment ${segment.index + 1}`)} /></div>)}</details>}
            {selected.error && <p className={styles.noticeError}><WarningCircle size={18} />{displayError(selected.error, lang)}</p>}
            {selected.segments.length > 0 ? <div className={styles.segments}>{selected.segments.map(segment => <article className={styles.segment} key={segment.index}><div className={styles.segmentTitle}><strong>{copy(`片段 ${segment.index + 1}`, `Segment ${segment.index + 1}`)}</strong><span>{segment.start.toFixed(1)}–{(segment.start + segment.duration).toFixed(1)}s</span></div><div className={styles.framePair}><Frame url={segment.opening_url} label={copy("开头画面", "Opening frame")} /><Frame url={segment.ending_url} label={copy("结尾画面", "Ending frame")} /></div></article>)}</div> : <div className={styles.emptySmall}><Clock size={26} /><p>{selected.status === "draft" ? copy("素材已保存。点击下方按钮后开始准备参考画面。", "Materials saved. Use the button below to start preparing reference frames.") : copy("等待服务准备参考画面。", "Waiting for reference frames to be prepared.")}</p></div>}
            {selected.status === "review" && <div className={styles.renderBox}><h3>{copy("确认生成视频", "Confirm video rendering")}</h3><p>{copy("RunningHub H3 · 768P。渲染按片段计费，以下是估算的 RunningHub coins，不是服务商的硬性支出上限。", "RunningHub H3 · 768P. Rendering is billed per segment. These RunningHub coins are an estimate, not a hard provider spending cap.")}</p><div className={styles.estimate}><span>{selected.estimate.segments} {copy("个片段", "segments")}</span><strong>{estimate === null ? copy("暂不可估算", "Estimate unavailable") : `≈ ${estimate} coins`}</strong></div>{estimate === null ? <p className={styles.validation}>{copy("未配置视频报价，当前无法提交渲染。", "Video pricing is not configured, so rendering is unavailable.")}</p> : <><label className={styles.checkbox}><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />{copy("我已核对参考画面，并同意按估算提交", "I reviewed the frames and accept the estimated cost")}</label><label className={styles.budgetLabel}>{copy("本次同意的最大估算 coins", "Maximum estimated coins I accept")}<input type="number" min={estimate} step="1" inputMode="numeric" value={budget} onChange={event => setBudget(event.target.value)} /></label></>}<button type="button" className={styles.primary} disabled={!canRender} onClick={render}>{busy === "render" ? <SpinnerGap size={18} className={styles.spin} /> : <ArrowRight size={18} />}{copy("确认并生成视频", "Confirm and render video")}</button></div>}
            {selected.status === "attention" && <div className={styles.stateNote}><WarningCircle size={19} /><span>{copy("服务状态需要核对。先检查已有任务，避免重复提交。", "The provider status needs checking. Check the existing task before taking further action.")}</span><button type="button" onClick={reconcile} disabled={Boolean(busy)}>{copy("检查现有任务", "Check existing task")}</button></div>}
            {selected.status === "failed" && <div className={styles.stateNote}><WarningCircle size={19} /><span>{copy("任务未完成。请查看上方错误信息，并先刷新项目状态。", "The task did not complete. Review the error above and refresh the project status first.")}</span><button type="button" onClick={() => void loadProject(selected.id).catch(cause => setSyncError(errorText(cause)))}>{copy("刷新状态", "Refresh status")}</button></div>}
            {selected.status === "draft" && <button type="button" className={styles.secondary} disabled={Boolean(busy) || !preparationReady} onClick={() => void run("prepare", async () => { const data = await json<{ project: VideoJobView }>(`/api/videos/projects/${selected.id}/prepare`, { method: "POST" }); chooseProject(data.project); await loadProjects(); })}>{copy("继续准备画面", "Continue preparing frames")}</button>}
            {selected.status === "completed" && <div id="video-result" className={styles.result}><h3><CheckCircle size={20} />{copy("视频已完成", "Video ready")}</h3>{selected.output_url && <video src={selected.output_url} controls playsInline preload="metadata" aria-label={copy("生成的视频", "Generated video")} />}{selected.download_url && <a className={styles.primary} href={selected.download_url}><DownloadSimple size={18} />{copy("下载视频", "Download video")}</a>}</div>}
          </>}
        </section>
      </div>
      <section className={styles.recent} aria-labelledby="recent-title"><div className={styles.recentHead}><div><span className={styles.eyebrow}>{copy("继续创作", "CONTINUE")}</span><h2 id="recent-title">{copy("最近项目", "Recent projects")}</h2></div><button type="button" onClick={() => void loadProjects()}>{copy("刷新", "Refresh")}</button></div>{projects.length ? <div className={styles.projectList}>{projects.map(project => <button type="button" className={styles.projectItem} key={project.id} onClick={() => { chooseProject(project); void loadProject(project.id).catch(cause => setSyncError(errorText(cause))); }} aria-pressed={selected?.id === project.id}><FilmStrip size={22} /><span><strong>{project.title}</strong><small>{dateText(project.updated_at, lang)}</small></span><Status status={project.status} lang={lang} /></button>)}</div> : <p className={styles.muted}>{capabilities?.signed_in ? copy("还没有视频项目。", "No video projects yet.") : copy("登录后可以查看自己的项目。", "Sign in to see your projects.")}</p>}{historyError && capabilities?.signed_in && <p className={styles.validation}>{copy("读取项目失败：", "Could not load projects: ")}{displayError(historyError, lang)}</p>}</section>
      <p className={styles.feedback} aria-live="polite" role={error ? "alert" : "status"}>{error && `${copy("操作未完成：", "Operation did not complete: ")}${displayError(error, lang)}`}</p>
    </main>
    <SiteFooter />
    <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onSignedIn={async () => { setLoginOpen(false); await loadCapabilities(); await loadProjects(); }} />
  </div>;
}

function Frame({ url, label }: { url: string | null; label: string }) {
  return <div className={styles.frame}><div className={styles.frameImage}>{url ? <img src={url} alt={label} /> : <ImageSquare size={22} aria-hidden="true" />}</div><span>{label}</span></div>;
}
function Status({ status, lang }: { status: VideoJobView["status"]; lang: "zh" | "en" }) {
  const labels: Record<VideoJobView["status"], [string, string]> = { draft: ["草稿", "Draft"], queued: ["排队中", "Queued"], preparing: ["准备画面", "Preparing"], review: ["待核对", "Review"], generating: ["生成中", "Rendering"], assembling: ["合成中", "Assembling"], completed: ["已完成", "Completed"], failed: ["失败", "Failed"], attention: ["待核查", "Needs check"] };
  return <span className={`${styles.status} ${status === "completed" ? styles.statusDone : status === "failed" || status === "attention" ? styles.statusWarn : ""}`}>{labels[status][lang === "zh" ? 0 : 1]}</span>;
}

