"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowsOut, Image as ImageIcon, X } from "@phosphor-icons/react";
import { LoginModal } from "@/components/auth/LoginModal";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Dialog } from "@/components/ui/Dialog";
import { useLang } from "@/components/i18n/LangProvider";
import { downloadOutputImage } from "@/lib/download-output";
import { isImageModelId, getImageModel, type ImageModelId } from "@/lib/image-models";

type Output = { id: string; image_url: string; thumbnail_url: string | null; is_downloaded: boolean };
type Job = { id: string; status: string; stage_hint: string | null; failure_reason: string | null; created_at: string; template_name: string | null; platform_style: string; aspect_ratio: string; image_model: ImageModelId | null; input_image_url: string; output_images: Output[] };
type LoadState = "loading" | "ready" | "unauth" | "error";

export default function MyWorksPage() {
  const { t, lang } = useLang();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [loginOpen, setLoginOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const copy = lang === "zh" ? {
    intro: "查看生成记录、核对原图并下载每张成品。", loading: "正在加载作品…",
    error: "作品暂时无法加载，请检查网络后重试。", retry: "重试", login: "登录后查看我的作品",
    loaded: "已加载的生成记录", source: "查看原图", preview: "图片预览",
  } : {
    intro: "Review generations, compare the source and download each image.", loading: "Loading your works…",
    error: "Your works could not be loaded. Check your connection and retry.", retry: "Retry", login: "Sign in to view your works",
    loaded: "Loaded generations", source: "View source", preview: "Image preview",
  };
  const load = useCallback(async (signal?: AbortSignal) => {
    setState("loading");
    try {
      const response = await fetch("/api/my/jobs", { cache: "no-store", signal });
      if (signal?.aborted) return;
      if (response.status === 401) { setJobs([]); setState("unauth"); return; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.jobs)) throw new Error("Invalid jobs response");
      if (signal?.aborted) return;
      setJobs(data.jobs);
      setState("ready");
    } catch {
      if (!signal?.aborted) setState("error");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return <div className="flex min-h-screen flex-col bg-[#faf9f6]">
    <SiteHeader active="my" />
    <main className="page-container flex-1 py-10 md:py-16">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="page-heading">{t("my_title")}</h1><p className="page-description mt-3">{copy.intro}</p></div>
        <Link href="/workspace" className="btn btn-primary">{t("nav_generate")}</Link>
      </div>
      {state === "loading" && <div className="surface p-8 text-[#6b7066]" role="status">{copy.loading}</div>}
      {state === "error" && <div className="surface p-8" role="alert"><p>{copy.error}</p><button type="button" className="btn btn-outline mt-4" onClick={() => void load()}>{copy.retry}</button></div>}
      {state === "unauth" && <div className="surface p-8 text-center"><ImageIcon size={34} className="mx-auto text-[#5b6350]" /><p className="mt-4 text-[#6b7066]">{copy.login}</p><button type="button" className="btn btn-primary mt-5" onClick={() => setLoginOpen(true)}>{t("nav_login")}</button></div>}
      {state === "ready" && jobs.length === 0 && <div className="surface p-10 text-center"><ImageIcon size={36} className="mx-auto text-[#5b6350]" /><p className="mt-4 text-[#6b7066]">{t("my_empty")}</p><Link href="/workspace" className="btn btn-primary mt-5">{t("my_back")}</Link></div>}
      {state === "ready" && jobs.length > 0 && <section aria-label={copy.loaded} className="space-y-5"><p className="text-sm text-[#6b7066]">{copy.loaded} · {jobs.length}</p>{jobs.map(job => <JobCard key={job.id} job={job} onPreview={setPreview} />)}</section>}
    </main>
    <SiteFooter />
    <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onSignedIn={() => { setLoginOpen(false); void load(); }} />
    <Dialog open={preview !== null} onClose={() => setPreview(null)} titleId="my-image-preview" className="!w-[min(100%,960px)] !max-w-[960px]">
      <div className="flex items-center justify-between gap-3"><h2 id="my-image-preview" className="text-lg font-semibold">{preview?.label || copy.preview}</h2><button type="button" className="icon-button" onClick={() => setPreview(null)} aria-label={t("login_close")}><X size={21} /></button></div>
      {preview && <div className="mt-5 grid max-h-[70dvh] place-items-center overflow-auto rounded-xl bg-[#f0f0ea] p-2">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={preview.url} alt={preview.label} className="max-h-[66dvh] max-w-full object-contain" /></div>}
    </Dialog>
  </div>;
}

function JobCard({ job, onPreview }: { job: Job; onPreview: (image: { url: string; label: string }) => void }) {
  const { t, lang } = useLang();
  const status = job.status === "completed" ? t("my_status_completed") : job.status === "failed" ? t("my_status_failed") : t("my_status_generating");
  const date = new Date(job.created_at);
  const aspect = job.aspect_ratio === "ratio_1_1" ? "1:1" : job.aspect_ratio === "ratio_4_5" ? "4:5" : job.aspect_ratio === "ratio_16_9" ? "16:9" : job.aspect_ratio;
  const modelName = isImageModelId(job.image_model) ? getImageModel(job.image_model).name : null;
  const count = lang === "zh" ? `已生成 ${job.output_images.length} 张` : `${job.output_images.length} generated`;
  const failureMessage = job.failure_reason?.includes("图片服务账号已迁移")
    ? (lang === "zh" ? "图片服务账号已迁移，请管理员更新图片配置后重试。" : "The image service account has migrated. Please ask an administrator to update the image configuration, then retry.")
    : job.failure_reason;
  return <article className="surface overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e5de] px-5 py-4">
      <div><h2 className="font-semibold">{job.template_name || (lang === "zh" ? "自定义场景" : "Custom scene")}</h2><p className="mt-1 text-xs text-[#6b7066]">{job.platform_style === "domestic_ecommerce" ? t("ws_platform_domestic") : t("ws_platform_brand")} · {aspect}{modelName ? ` · ${modelName}` : ""} · {count}</p></div>
      <div className="flex flex-wrap items-center gap-3"><span className={`rounded-full px-3 py-1 text-xs ${job.status === "failed" ? "bg-red-50 text-red-700" : job.status === "completed" ? "bg-[#e9eee3] text-[#46543d]" : "bg-[#f4f0e5] text-[#776446]"}`}>{status}</span><time dateTime={job.created_at} className="text-xs text-[#6b7066]">{Number.isNaN(date.getTime()) ? job.created_at : date.toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}</time></div>
    </div>
    <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
      <figure className="overflow-hidden rounded-xl border border-[#e5e5de] bg-[#f1f1ec]"><button type="button" className="block w-full" onClick={() => onPreview({ url: job.input_image_url, label: t("my_input_label") })} aria-label={lang === "zh" ? "查看原图" : "View source"}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={job.input_image_url} alt={t("my_input_label")} className="aspect-square w-full object-contain" /></button><figcaption className="flex items-center justify-between px-3 py-2 text-xs text-[#6b7066]"><span>{t("my_input_label")}</span><ArrowsOut size={15} /></figcaption></figure>
      {job.output_images.map((output, index) => <OutputCell key={output.id} output={output} index={index + 1} onPreview={onPreview} />)}
      {job.output_images.length === 0 && <div className="flex items-center rounded-xl border border-dashed border-[#e5e5de] p-5 text-sm text-[#6b7066] lg:col-span-3">{job.status === "failed" ? (failureMessage || t("my_status_failed")) : (job.stage_hint || (lang === "zh" ? "作品正在生成中" : "Generation in progress"))}</div>}
    </div>
  </article>;
}

function OutputCell({ output, index, onPreview }: { output: Output; index: number; onPreview: (image: { url: string; label: string }) => void }) {
  const { t, lang } = useLang();
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const downloading = useRef(false);
  const label = lang === "zh" ? `成品 ${index}` : `Output ${index}`;
  const download = async () => {
    if (downloading.current) return;
    downloading.current = true;
    setPending(true); setError(false);
    try {
      await downloadOutputImage(output.id);
    } catch { setError(true); } finally { setPending(false); downloading.current = false; }
  };
  return <figure className="overflow-hidden rounded-xl border border-[#e5e5de] bg-[#f1f1ec]">
    <button type="button" className="block w-full" onClick={() => onPreview({ url: output.image_url, label })} aria-label={lang === "zh" ? `放大查看 ${label}` : `Enlarge ${label}`}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={output.thumbnail_url || output.image_url} alt={label} className="aspect-square w-full object-cover" /></button>
    <figcaption className="flex items-center justify-between gap-2 bg-white px-3 py-2"><span className="text-xs text-[#6b7066]">{label}</span><button type="button" className="btn btn-outline !min-h-0 !px-2.5 !py-1.5 !text-xs" disabled={pending} onClick={() => void download()}><ArrowDown size={15} />{pending ? "…" : t("my_btn_download")}</button></figcaption>
    {error && <p role="alert" className="bg-white px-3 pb-2 text-xs text-red-700">{lang === "zh" ? "下载暂时失败，请重试。" : "Download failed. Please retry."}</p>}
  </figure>;
}
