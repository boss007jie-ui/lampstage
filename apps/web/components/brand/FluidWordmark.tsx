import Image from "next/image";

export function FluidWordmark() {
  return <span className="fluid-wordmark" aria-hidden="true">
    <Image src="/brand-gallery/lampstage-white.svg" alt="" width={800} height={240} priority />
  </span>;
}
