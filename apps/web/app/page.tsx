"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LangToggle } from "@/components/i18n/LangToggle";
import { useLang } from "@/components/i18n/LangProvider";
import { BrandMark } from "@/components/brand/BrandMark";
import { LoginModal } from "@/components/auth/LoginModal";
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  // 滚动 / 路由变化时关掉 mobile menu
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, { passive: true });
    return () => window.removeEventListener("scroll", close);
  }, [open]);

  const links = [
    { href: "#showcase", label: t("nav_showcase") },
    { href: "#product", label: t("nav_product") },
    { href: "#styles", label: t("nav_styles") },
    { href: "#pricing", label: t("nav_pricing") },
  ];

  return (
    <nav className="relative mx-auto flex max-w-[1180px] items-center justify-between gap-3 px-5 py-4 md:px-6">
      <Link
        href="/"
        className="flex items-center gap-2 text-[18px] font-semibold tracking-tight md:text-[22px]"
      >
        <BrandMark size={26} onLight />
        {lang === "zh" ? `${BRAND.en} · ${BRAND.cn}` : BRAND.en}
      </Link>

      {/* 桌面：横向链接 */}
      <div className="hidden gap-7 text-[#273951] md:flex">
        {links.map((l) => (
          <Link key={l.href} href={l.href}>
            {l.label}
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        <LangToggle />
        <button
          type="button"
          onClick={() => setLoginOpen(true)}
          className="hidden rounded-md border border-[#d6d9fc] px-4 py-2 text-[14px] text-[#533afd] transition-colors hover:bg-[#533afd]/5 sm:inline-block"
        >
          {t("nav_login")}
        </button>
        {/* 手机：汉堡 */}
        <button
          type="button"
          onClick={() => setOpen((s) => !s)}
          aria-label="menu"
          aria-expanded={open}
          className="grid h-10 w-10 place-items-center rounded-md border border-[#e5edf5] text-[#273951] md:hidden"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {open ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* 手机：展开抽屉 */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mx-3 mt-2 rounded-2xl border border-[#e5edf5] bg-white p-2 shadow-2xl md:hidden">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-4 py-3 text-[15px] text-[#273951] hover:bg-[#f8fafc]"
            >
              {l.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setLoginOpen(true);
            }}
            className="mt-1 block w-full rounded-lg bg-[#533afd] px-4 py-3 text-center text-[15px] font-medium text-white"
          >
            {t("nav_login")}
          </button>
        </div>
      )}
      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSignedIn={() => {
          setLoginOpen(false);
          router.push("/workspace");
        }}
      />
    </nav>
  );
}

function Hero() {
  const { t } = useLang();
  return (
    <section className="mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-8 px-5 py-8 md:grid-cols-[0.92fr_1.08fr] md:gap-10 md:px-6 md:py-14">
      <div>
        <span className="inline-block rounded-full border border-[#e5edf5] bg-white px-3 py-1 text-[12px] tracking-wide text-[#64748d]">
          {t("hero_badge")}
        </span>
        <h1 className="mt-4 text-[32px] font-light leading-[1.08] tracking-[-1px] sm:text-[42px] sm:leading-[1.05] sm:tracking-[-1.2px] md:text-[58px]">
          {t("hero_title")}
        </h1>
        <p className="mt-4 text-[16px] leading-[1.55] text-[#64748d] sm:mt-6 sm:text-[18px] md:text-[20px]">
          {t("hero_subtitle")}
        </p>
        <div className="mt-6 flex flex-wrap gap-3 sm:mt-7">
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
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#94a3b8] sm:mt-6">
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
      className="overflow-hidden rounded-[16px] border border-[#e5edf5] bg-black md:rounded-[20px]"
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
    <section id="showcase" className="mx-auto max-w-[1180px] px-5 pb-2 pt-2 md:px-6">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[#94a3b8] md:text-[12px]">
            {t("showcase_eyebrow")}
          </div>
          <h2 className="mt-1 text-[22px] font-light tracking-tight md:text-[28px]">
            {t("showcase_title")}
          </h2>
        </div>
        <Link
          href="/workspace"
          className="hidden flex-none text-[14px] text-[#533afd] hover:underline md:inline"
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
            <figcaption className="absolute bottom-3 left-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black/55 px-2.5 py-1 text-[11px] text-white backdrop-blur sm:text-[12px]">
                {t(it.titleKey)}
              </span>
              <span className="rounded-full bg-white/85 px-2.5 py-1 text-[11px] text-[#061b31] backdrop-blur sm:text-[12px]">
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
    <section className="mx-auto max-w-[1180px] px-5 pb-4 pt-4 md:px-6 md:pb-6 md:pt-8">
      <div className="grid grid-cols-3 gap-2 sm:gap-4 md:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.label}
            className="rounded-xl border border-[#e5edf5] bg-white p-3 sm:p-5"
          >
            <div className="text-[18px] font-light text-[#061b31] sm:text-[28px]">
              {it.value}
            </div>
            <div className="text-[12px] text-[#64748d] sm:text-[14px]">{it.label}</div>
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
      className="mx-auto my-8 max-w-[1180px] rounded-3xl bg-[#1c1e54] px-5 py-8 text-white sm:my-10 sm:px-6 sm:py-10 md:px-10 md:py-12"
    >
      <h2 className="mb-5 text-[22px] font-light tracking-tight sm:text-[28px] sm:mb-6">
        {t("how_title")}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <div key={s.tag} className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-[#ffd36a]">
              {s.icon}
            </div>
            <small className="font-mono text-[12px] text-[#b9b9f9]">{s.tag}</small>
            <h3 className="mt-2 text-[20px] font-light sm:text-[22px]">{s.title}</h3>
            <p className="mt-1 text-[14px] text-white/70 sm:text-[15px]">{s.desc}</p>
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
      className="mx-auto grid max-w-[1180px] grid-cols-1 gap-4 px-5 py-8 sm:gap-5 sm:py-10 md:grid-cols-2 md:px-6"
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
      <div className="h-40 w-full bg-cover bg-center sm:h-48" style={{ backgroundImage: `url('${cover}')` }} />
      <div className="p-5 sm:p-6">
        <h3 className="mb-2 text-[20px] font-light sm:text-[24px]">{title}</h3>
        <p className="text-[14px] text-[#64748d] sm:text-[15px]">{desc}</p>
      </div>
    </div>
  );
}

function Footer() {
  const { t, lang } = useLang();
  return (
    <footer className="border-t border-[#e5edf5] px-5 py-6 text-center text-[12px] text-[#64748d] sm:py-8 sm:text-sm">
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
