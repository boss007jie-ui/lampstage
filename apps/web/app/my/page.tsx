"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LangToggle } from "@/components/i18n/LangToggle";
import { useLang } from "@/components/i18n/LangProvider";
import { BRAND } from "@/lib/brand";

type Output = {
  id: string;
  image_url: string;
  thumbnail_url: string | null;
  is_downloaded: boolean;
};
type Job = {
  id: string;
  status: string;
  stage_hint: string | null;
  failure_reason: string | null;
  created_at: string;
  template_name: string;
  lamp_type: string;
  scene_space: string;
  platform_style: string;
  aspect_ratio: string;
  input_image_url: string;
  output_images: Output[];
};

export default function MyWorksPage() {
  const { t, lang } = useLang();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [unauth, setUnauth] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/my/jobs", { cache: "no-store" })
      .then(async (r) => {
        if (!cancelled) {
          if (r.status === 401) {
            setUnauth(true);
          } else if (r.ok) {
            const data = await r.json();
            setJobs(data.jobs || []);
          }
          setLoading(false);
        }
      })
      .catch(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#f7f7f5]">
      <header className="border-b border-[#e8e5df] bg-white">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4 md:px-6">
          <Link href="/" className="text-[18px] font-semibold tracking-tight md:text-[22px]">
            {lang === "zh" ? `${BRAND.en} · ${BRAND.cn}` : BRAND.en}
          </Link>
          <div className="flex items-center gap-3">
            <LangToggle />
            <Link
              href="/workspace"
              className="rounded-md bg-[#171717] px-4 py-2 text-[14px] text-white"
            >
              {t("nav_generate")}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 py-8 md:px-6 md:py-10">
        <h1 className="text-[28px] font-light tracking-[-0.5px] md:text-[36px]">
          {t("my_title")}
        </h1>

        {loading && (
          <p className="mt-6 text-[#94a3b8]">…</p>
        )}

        {!loading && unauth && (
          <div className="mt-8 rounded-2xl border border-[#e5edf5] bg-white p-8 text-center">
            <p className="text-[#64748d]">{t("login_title")}</p>
            <Link
              href="/workspace"
              className="mt-4 inline-block rounded-md bg-[#533afd] px-5 py-2.5 text-white"
            >
              {t("nav_generate")}
            </Link>
          </div>
        )}

        {!loading && !unauth && jobs.length === 0 && (
          <div className="mt-8 rounded-2xl border border-dashed border-[#e5edf5] bg-white p-10 text-center">
            <p className="text-[#64748d]">{t("my_empty")}</p>
            <Link
              href="/workspace"
              className="mt-4 inline-block rounded-md bg-[#171717] px-5 py-2.5 text-white"
            >
              {t("my_back")}
            </Link>
          </div>
        )}

        {!loading && jobs.length > 0 && (
          <div className="mt-6 space-y-5">
            {jobs.map((j) => (
              <JobCard key={j.id} job={j} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const { t } = useLang();
  const statusLabel =
    job.status === "completed"
      ? t("my_status_completed")
      : job.status === "failed"
        ? t("my_status_failed")
        : t("my_status_generating");
  const statusColor =
    job.status === "completed"
      ? "bg-emerald-50 text-emerald-700"
      : job.status === "failed"
        ? "bg-red-50 text-red-700"
        : "bg-amber-50 text-amber-700";
  const aspectShort =
    job.aspect_ratio === "ratio_1_1"
      ? "1:1"
      : job.aspect_ratio === "ratio_4_5"
        ? "4:5"
        : "16:9";
  return (
    <article className="overflow-hidden rounded-2xl border border-[#e5edf5] bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f1f5f9] px-5 py-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-[#061b31]">{job.template_name}</span>
          <span className="text-[#94a3b8]">·</span>
          <span className="text-[#64748d]">
            {job.platform_style === "domestic_ecommerce" ? t("ws_platform_domestic") : t("ws_platform_brand")}
          </span>
          <span className="text-[#94a3b8]">·</span>
          <span className="text-[#64748d]">{aspectShort}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-[11px] ${statusColor}`}>
            {statusLabel}
          </span>
          <time className="text-[12px] text-[#94a3b8]">
            {new Date(job.created_at).toLocaleString()}
          </time>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-5">
        <figure className="col-span-2 overflow-hidden rounded-xl border border-[#e5edf5] bg-black sm:col-span-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={job.input_image_url}
            alt={t("my_input_label")}
            className="h-full w-full object-contain"
            style={{ aspectRatio: "1 / 1" }}
          />
          <figcaption className="px-2 py-1 text-center text-[11px] text-[#94a3b8]">
            {t("my_input_label")}
          </figcaption>
        </figure>
        {job.output_images.length === 0 && job.status === "failed" && (
          <div className="col-span-2 rounded-xl border border-red-100 bg-red-50 p-4 text-[13px] text-red-700 sm:col-span-4">
            {job.failure_reason || t("my_status_failed")}
          </div>
        )}
        {job.output_images.length === 0 && job.status !== "failed" && (
          <div className="col-span-2 rounded-xl border border-dashed border-[#e5edf5] p-4 text-center text-[13px] text-[#94a3b8] sm:col-span-4">
            …
          </div>
        )}
        {job.output_images.map((o) => (
          <OutputCell key={o.id} output={o} />
        ))}
      </div>
    </article>
  );
}

function OutputCell({ output }: { output: Output }) {
  const { t } = useLang();
  const onDownload = async () => {
    const r = await fetch(`/api/output-images/${output.id}/download`, {
      method: "POST",
    });
    const data = await r.json().catch(() => ({}));
    const url = data.image_url || output.image_url;
    // 触发浏览器下载
    const a = document.createElement("a");
    a.href = url;
    a.download = url.split("/").pop() || "lampstage.jpg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  return (
    <figure className="group relative overflow-hidden rounded-xl border border-[#e5edf5] bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={output.thumbnail_url || output.image_url}
        alt="output"
        className="h-full w-full object-cover"
        style={{ aspectRatio: "1 / 1" }}
      />
      <button
        onClick={onDownload}
        className="absolute bottom-2 right-2 rounded-md bg-black/65 px-2.5 py-1 text-[11px] text-white backdrop-blur transition-opacity opacity-0 group-hover:opacity-100"
      >
        {t("my_btn_download")}
      </button>
    </figure>
  );
}
