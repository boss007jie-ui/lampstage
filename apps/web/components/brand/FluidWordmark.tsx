"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useBrandMotion } from "./BrandMotion";

export function FluidWordmark() {
  const { enabled } = useBrandMotion();
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setPlaying(false);
    const element = video.current;
    if (!element) return;
    const update = () => {
      if (!enabled || document.hidden) element.pause();
      else void element.play().catch(() => setPlaying(false));
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [enabled]);
  return <span className={`fluid-wordmark ${enabled && playing ? "has-motion" : ""}`} aria-hidden="true">
    <Image src="/brand-gallery/lampstage-static.svg" alt="" width={800} height={240} priority />
    {enabled && <video ref={video} className={playing ? "is-playing" : ""} width={800} height={240}
      autoPlay muted loop playsInline preload="metadata" onPlaying={() => setPlaying(true)}
      onError={() => setPlaying(false)} tabIndex={-1} aria-hidden="true">
      <source src="/brand-gallery/lampstage-warm.webm" type="video/webm" />
    </video>}
  </span>;
}
