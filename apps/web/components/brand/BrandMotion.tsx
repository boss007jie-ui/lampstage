"use client";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";

const MotionContext = createContext({ enabled: false, toggle: () => {} });
export function BrandMotionProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    setEnabled(!preference.matches);
    const update = () => setEnabled(!preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  return <MotionContext.Provider value={{ enabled, toggle: () => setEnabled(value => !value) }}>{children}</MotionContext.Provider>;
}
export function useBrandMotion() { return useContext(MotionContext); }
