"use client";

import Link from "next/link";
import { LangToggle } from "@/components/i18n/LangToggle";
import { useLang } from "@/components/i18n/LangProvider";
import { BRAND } from "@/lib/brand";

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <NavBar />
      <Hero />
      <ShowcaseGallery />
      <Stats />
      <HowItWorks />
      <Styles />
      <Footer />
    </main>
  );
}

function NavBar() {
  const { t, lang } = useLang();
  return (
    <nav className="mx-auto flex max-w-[1180px] items-center justify-between px-6 py-4">
      <Link href="/" className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
        <span
          aria-hidden
          className="inline-block h-3 w-3 rounded-full bg-[#d69a3a] shadow-[0_0_22px_#d69a3a]"
        />
        {lang === "zh" ? `${BRAND.en} · ${BRAND.cn}` : BRAND.en}
      </Link>
      <div className="hidden gap-7 text-[#273951] md:flex">
        <Link href="#showcase">{t("nav_showcase")}</Link>
        <Link href="#product">{t("nav_product")}</Link>
        <Link href="#styles">{t("nav_styles")}</Link>
        <Link href="#pricing">{t("nav_pricing")}</Link>
      </div>
      <div className="flex items-center gap-3">
        <LangToggle />
        <Link
          href="/workspace"
          className="rounded-md border border-[#d6d9fc] px-4 py-2 text-[#533afd] transition-colors hover:bg-[#533afd]/5"
        >
          {t("nav_login")}
        </Link>
      </div>
    </nav>
  );
}

function Hero() {
  const { t } = useLang();
  return (
    <section className="mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-10 px-6 py-10 md:grid-cols-[0.92fr_1.08fr] md:py-14">
      <div>
        <span className="inline-block rounded-full border border-[#e5edf5] bg-white px-3 py-1 text-[12px] tracking-wide text-[#64748d]">
          {t("hero_badge")}
        </span>
        <h1 className="mt-4 text-[42px] font-light leading-[1.05] tracking-[-1.2px] md:text-[58px]">
          {t("hero_title")}
        </h1>
        <p className="mt-6 text-[18px] leading-[1.55] text-[#64748d] md:text-[20px]">
          {t("hero_subtitle")}
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/workspace"
            className="rounded-md bg-[#533afd] px-5 py-3 font-medium text-white transition-colors hover:bg-[#4434d4]"
          >
            {t("hero_cta_primary")}
          </Link>
          <Link
            href="#showcase"
            className="rounded-md border border-[#d6d9fc] px-5 py-3 font-medium text-[#533afd] transition-colors hover:bg-[#533afd]/5"
          >
            {t("hero_cta_secondary")}
          </Link>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-4 text-[12px] text-[#94a3b8]">
          <span>· {t("hero_meta_speed")}</span>
          <span>· {t("hero_meta_count")}</span>
          <span>· {t("hero_meta_styles")}</span>
        </div>
      </div>
      <HeroVisual />
    </section>
  );
}

function HeroVisual() {
  return (
    <div
      className="overflow-hidden rounded-[20px] border border-[#e5edf5] bg-black"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/showcase/01_living_pendant.jpg"
        alt="Living-room pendant scene example"
        className="h-full w-full object-cover"
        style={{ aspectRatio: "16 / 10" }}
      />
    </div>
  );
}

function ShowcaseGallery() {
  const { t } = useLang();
  const items = [
    { src: "/showcase/02_dining_long_table.jpg", titleKey: "showcase_item_1", tagKey: "showcase_tag_domestic" },
    { src: "/showcase/03_bedroom_wall_sconce.jpg", titleKey: "showcase_item_2", tagKey: "showcase_tag_brand" },
    { src: "/showcase/04_floor_lamp_corner.jpg", titleKey: "showcase_item_3", tagKey: "showcase_tag_domestic" },
    { src: "/showcase/05_hotel_lobby.jpg", titleKey: "showcase_item_4", tagKey: "showcase_tag_brand" },
  ] as const;

  return (
    <section id="showcase" className="mx-auto max-w-[1180px] px-6 pb-2 pt-2">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-[#94a3b8]">
            {t("showcase_eyebrow")}
          </div>
          <h2 className="mt-1 text-[28px] font-light tracking-tight">
            {t("showcase_title")}
          </h2>
        </div>
        <Link
          href="/workspace"
          className="hidden text-[14px] text-[#533afd] hover:underline md:inline"
        >
          {t("showcase_cta")}
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((it) => (
          <figure
            key={it.src}
            className="group relative overflow-hidden rounded-2xl border border-[#e5edf5] bg-black"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={it.src}
              alt={t(it.titleKey)}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              style={{ aspectRatio: "16 / 10" }}
            />
            <figcaption className="absolute bottom-3 left-3 flex items-center gap-2">
              <span className="rounded-full bg-black/55 px-2.5 py-1 text-[12px] text-white backdrop-blur">
                {t(it.titleKey)}
              </span>
              <span className="rounded-full bg-white/85 px-2.5 py-1 text-[12px] text-[#061b31] backdrop-blur">
                {t(it.tagKey)}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function Stats() {
  const { t } = useLang();
  const items = [
    { value: t("stat_speed_value"), label: t("stat_speed_label") },
    { value: t("stat_count_value"), label: t("stat_count_label") },
    { value: t("stat_credits_value"), label: t("stat_credits_label") },
  ];
  return (
    <section className="mx-auto max-w-[1180px] px-6 pb-6 pt-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-xl border border-[#e5edf5] bg-white p-5">
            <div className="text-[28px] font-light text-[#061b31]">{it.value}</div>
            <div className="text-[#64748d]">{it.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const { t } = useLang();
  const steps = [
    { tag: t("how_step1_tag"), title: t("how_step1_title"), desc: t("how_step1_desc"), icon: <UploadIcon /> },
    { tag: t("how_step2_tag"), title: t("how_step2_title"), desc: t("how_step2_desc"), icon: <TemplateIcon /> },
    { tag: t("how_step3_tag"), title: t("how_step3_title"), desc: t("how_step3_desc"), icon: <ExportIcon /> },
  ];
  return (
    <section
      id="product"
      className="mx-auto my-10 max-w-[1180px] rounded-3xl bg-[#1c1e54] px-6 py-10 text-white md:px-10 md:py-12"
    >
      <h2 className="mb-6 text-[28px] font-light tracking-tight">{t("how_title")}</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <div key={s.tag} className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-[#ffd36a]">
              {s.icon}
            </div>
            <small className="font-mono text-[12px] text-[#b9b9f9]">{s.tag}</small>
            <h3 className="mt-2 text-[22px] font-light">{s.title}</h3>
            <p className="mt-1 text-white/70">{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Styles() {
  const { t } = useLang();
  return (
    <section
      id="styles"
      className="mx-auto grid max-w-[1180px] grid-cols-1 gap-5 px-6 py-10 md:grid-cols-2"
    >
      <StyleCard
        title={t("styles_domestic_title")}
        desc={t("styles_domestic_desc")}
        cover="/showcase/04_floor_lamp_corner.jpg"
      />
      <StyleCard
        title={t("styles_brand_title")}
        desc={t("styles_brand_desc")}
        cover="/showcase/03_bedroom_wall_sconce.jpg"
      />
    </section>
  );
}

function StyleCard({
  title,
  desc,
  cover,
}: {
  title: string;
  desc: string;
  cover: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#e5edf5] bg-white">
      <div className="h-48 w-full bg-cover bg-center" style={{ backgroundImage: `url('${cover}')` }} />
      <div className="p-6">
        <h3 className="mb-2 text-[24px] font-light">{title}</h3>
        <p className="text-[#64748d]">{desc}</p>
      </div>
    </div>
  );
}

function Footer() {
  const { t, lang } = useLang();
  return (
    <footer className="border-t border-[#e5edf5] py-8 text-center text-sm text-[#64748d]">
      © {new Date().getFullYear()} {lang === "zh" ? `${BRAND.en} · ${BRAND.cn}` : BRAND.en} ·{" "}
      {t("footer_tagline")} · {BRAND.domain}
    </footer>
  );
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function TemplateIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
