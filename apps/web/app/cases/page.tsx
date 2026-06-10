import Link from "next/link";

export default function CasesPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[800px] flex-col items-start justify-center px-6">
      <h1 className="text-[36px] font-light tracking-[-1px]">案例</h1>
      <p className="mt-3 text-[#64748d]">
        正在筛选优质案例。MVP 阶段的真实灯具场景图样片将在测试用户验证后陆续公开。
      </p>
      <Link
        href="/"
        className="mt-6 rounded-md border border-[#d6d9fc] px-4 py-2 text-[#533afd]"
      >
        返回首页
      </Link>
    </main>
  );
}
