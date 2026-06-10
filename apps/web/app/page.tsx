import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <NavBar />
      <Hero />
      <Stats />
      <HowItWorks />
      <Styles />
      <Footer />
    </main>
  );
}

function NavBar() {
  return (
    <nav className="mx-auto flex max-w-[1180px] items-center justify-between px-6 py-4">
      <div className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
        <span
          aria-hidden
          className="inline-block h-3 w-3 rounded-full bg-[#d69a3a] shadow-[0_0_22px_#d69a3a]"
        />
        灯境 AI
      </div>
      <div className="hidden gap-7 text-[#273951] md:flex">
        <Link href="#product">产品</Link>
        <Link href="#templates">模板</Link>
        <Link href="/cases">案例</Link>
        <Link href="#pricing">价格</Link>
      </div>
      <Link
        href="/workspace"
        className="rounded-md border border-[#d6d9fc] px-4 py-2 text-[#533afd] transition-colors hover:bg-[#533afd]/5"
      >
        登录
      </Link>
    </nav>
  );
}

function Hero() {
  return (
    <section className="mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-14 px-6 py-12 md:grid-cols-[0.95fr_1.05fr] md:py-16">
      <div>
        <h1 className="text-[42px] font-light leading-[1.05] tracking-[-1.2px] md:text-[58px]">
          一张灯具图，生成可直接上架的家居场景图。
        </h1>
        <p className="mt-6 text-[18px] leading-[1.5] text-[#64748d] md:text-[20px]">
          为灯具卖家快速生成适用于淘宝、天猫、1688、Shopify 和独立站的专业场景图，
          减少拍摄成本，加快上新速度。
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/workspace"
            className="rounded-md bg-[#533afd] px-5 py-3 font-medium text-white transition-colors hover:bg-[#4434d4]"
          >
            开始生成场景图
          </Link>
          <Link
            href="/cases"
            className="rounded-md border border-[#d6d9fc] px-5 py-3 font-medium text-[#533afd] transition-colors hover:bg-[#533afd]/5"
          >
            查看案例
          </Link>
        </div>
      </div>
      <HeroVisual />
    </section>
  );
}

function HeroVisual() {
  return (
    <div
      className="rounded-[18px] border border-[#e5edf5] bg-gradient-to-b from-white to-[#fafcff] p-4"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div
        className="relative h-[420px] overflow-hidden rounded-[14px]"
        style={{
          backgroundImage:
            "linear-gradient(145deg, #eadbca, #746554)",
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 62% 26%, rgba(255,217,116,0.72), transparent 23%), linear-gradient(transparent 64%, rgba(0,0,0,0.16))",
          }}
        />
        <div
          aria-hidden
          className="absolute left-[55%] top-0 h-[145px] w-[2px] bg-[rgba(40,25,15,0.45)]"
        />
        <div
          aria-hidden
          className="absolute left-1/2 top-[128px] h-[75px] w-[128px] -translate-x-1/2 rounded-[70px_70px_32px_32px]"
          style={{
            background:
              "linear-gradient(#fff3c2, #d49335 70%, #4d2b12)",
            boxShadow: "0 0 90px 34px rgba(255,213,92,0.5)",
          }}
        />
        <div
          aria-hidden
          className="absolute bottom-12 left-20 right-20 h-16 rounded-full bg-[#5d4433]"
        />
      </div>
    </div>
  );
}

function Stats() {
  const items = [
    { value: "30–60s", label: "出图速度" },
    { value: "4 张", label: "一次预览" },
    { value: "20 次", label: "新用户免费额度" },
  ];
  return (
    <section className="mx-auto max-w-[1180px] px-6 pb-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.label}
            className="rounded-xl border border-[#e5edf5] bg-white p-5"
          >
            <div className="text-[28px] font-light text-[#061b31]">
              {it.value}
            </div>
            <div className="text-[#64748d]">{it.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { tag: "01 UPLOAD", title: "上传灯具图", desc: "支持白底图、透明 PNG、普通商品图。" },
    { tag: "02 TEMPLATE", title: "选择家居模板", desc: "客厅、餐厅、卧室、酒店、展厅。" },
    { tag: "03 EXPORT", title: "下载电商图", desc: "生成 1:1、4:5、16:9 多比例图片。" },
  ];
  return (
    <section
      id="product"
      className="mx-auto my-10 max-w-[1180px] rounded-3xl bg-[#1c1e54] px-6 py-10 text-white md:px-10 md:py-12"
    >
      <h2 className="mb-6 text-[28px] font-light tracking-tight">
        三步生成专业灯具电商图
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <div
            key={s.tag}
            className="rounded-2xl border border-white/10 bg-white/5 p-5"
          >
            <small className="font-mono text-[12px] text-[#b9b9f9]">
              {s.tag}
            </small>
            <h3 className="mt-2 text-[22px] font-light">{s.title}</h3>
            <p className="mt-1 text-white/70">{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Styles() {
  return (
    <section
      id="templates"
      className="mx-auto grid max-w-[1180px] grid-cols-1 gap-5 px-6 py-10 md:grid-cols-2"
    >
      <div className="rounded-2xl border border-[#e5edf5] p-6">
        <h3 className="mb-2 text-[24px] font-light">国内电商风格</h3>
        <p className="text-[#64748d]">
          画面更明亮，产品更突出，适合淘宝、天猫、1688 主图和详情场景。
        </p>
      </div>
      <div className="rounded-2xl border border-[#e5edf5] p-6">
        <h3 className="mb-2 text-[24px] font-light">独立站品牌风格</h3>
        <p className="text-[#64748d]">
          更自然、更高级、更生活方式化，适合 Shopify 和外贸官网展示。
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[#e5edf5] py-8 text-center text-sm text-[#64748d]">
      © {new Date().getFullYear()} 灯境 AI · 为灯具卖家生成专业电商场景图
    </footer>
  );
}
