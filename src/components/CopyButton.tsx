"use client";

import { useEffect, useState } from "react";

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const CopyIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);

export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  className = "btn btn-secondary",
  icon = true,
  ariaLabel,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  icon?: boolean;
  ariaLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      aria-live="polite"
      onClick={async () => {
        if (await copyText(text)) setCopied(true);
      }}
    >
      {icon && CopyIcon}
      {copied ? copiedLabel : label}
    </button>
  );
}
