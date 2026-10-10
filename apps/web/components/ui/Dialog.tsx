"use client";

import { ReactNode, useEffect, useRef } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  titleId: string;
  children: ReactNode;
  className?: string;
};

export function Dialog({ open, onClose, titleId, children, className = "" }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const openerRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) {
      const rememberFocus = () => {
        if (!openRef.current && document.activeElement instanceof HTMLElement) openerRef.current = document.activeElement;
      };
      const rememberTrigger = (event: Event) => {
        if (openRef.current || !(event.target instanceof Element)) return;
        const trigger = event.target.closest<HTMLElement>('button, a[href], input, [tabindex="0"]');
        if (trigger) openerRef.current = trigger;
      };
      rememberFocus();
      document.addEventListener("focusin", rememberFocus);
      document.addEventListener("click", rememberTrigger, true);
      document.addEventListener("keydown", rememberTrigger, true);
      return () => {
        document.removeEventListener("focusin", rememberFocus);
        document.removeEventListener("click", rememberTrigger, true);
        document.removeEventListener("keydown", rememberTrigger, true);
      };
    }
    // Child autoFocus runs during mount, so remember the trigger while closed.
    const previous = openerRef.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
    ) ?? []).filter((el) => el.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => (focusable()[0] ?? panel)?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) {
          event.preventDefault();
          panel?.focus();
        } else if (!panel?.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={() => closeRef.current()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        tabIndex={-1} className={`dialog-panel ${className}`} onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
