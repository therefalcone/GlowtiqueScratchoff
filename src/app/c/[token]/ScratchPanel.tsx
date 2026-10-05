"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const CLEAR_AT = 0.55;
const BRUSH = 44;

const FOIL_STOPS: Array<[number, string]> = [
  [0, "#a97a25"],
  [0.22, "#e9c775"],
  [0.38, "#fbeab8"],
  [0.52, "#c7992f"],
  [0.68, "#f4dc98"],
  [0.84, "#b6862a"],
  [1, "#e7c672"],
];

function paintFoil(canvas: HTMLCanvasElement, displayNumber: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = "source-over";

  const grad = ctx.createLinearGradient(0, 0, w, h);
  for (const [stop, color] of FOIL_STOPS) grad.addColorStop(stop, color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // brushed sheen: thin diagonal lines
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.translate(w / 2, h / 2);
  ctx.rotate((25 * Math.PI) / 180);
  const span = Math.hypot(w, h);
  for (let x = -span; x < span; x += 7) {
    ctx.beginPath();
    ctx.moveTo(x, -span);
    ctx.lineTo(x, span);
    ctx.stroke();
  }
  ctx.restore();

  const glow = ctx.createRadialGradient(w * 0.2, 0, 0, w * 0.2, 0, w * 0.55);
  glow.addColorStop(0, "rgba(255,255,255,0.55)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  const heading = `800 11px Archivo, system-ui, sans-serif`;
  ctx.fillStyle = "#4a3410";
  ctx.font = heading;
  ctx.textBaseline = "top";
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "1.5px";
  ctx.fillText(`NO. ${displayNumber}`, 18, 18);

  // "SCRATCH TO REVEAL" sits left of the 28px icon; shrink until it fits.
  ctx.fillStyle = "#3a280a";
  ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "1.3px";
  const maxTextWidth = w - 18 * 2 - 28 - 12;
  let size = 22;
  ctx.font = `800 ${size}px Archivo, system-ui, sans-serif`;
  while (size > 14 && ctx.measureText("SCRATCH TO REVEAL").width > maxTextWidth) {
    size -= 1;
    ctx.font = `800 ${size}px Archivo, system-ui, sans-serif`;
  }
  ctx.fillText("SCRATCH TO REVEAL", 18, h - 22);

  // pencil-ruler icon (Lucide), bottom right, 28px
  ctx.save();
  ctx.translate(w - 18 - 28, h - 18 - 28);
  ctx.scale(28 / 24, 28 / 24);
  ctx.strokeStyle = "#3a280a";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of ["M12 19l7-7 3 3-7 7-3-3z", "M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z", "M2 2l7.586 7.586"]) {
    ctx.stroke(new Path2D(d));
  }
  ctx.beginPath();
  ctx.arc(11, 11, 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function clearedFraction(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width === 0) return 0;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const stride = 4;
  let total = 0;
  let clear = 0;
  for (let y = 0; y < canvas.height; y += stride) {
    for (let x = 0; x < canvas.width; x += stride) {
      total++;
      if (data[(y * canvas.width + x) * 4 + 3] < 128) clear++;
    }
  }
  return total ? clear / total : 0;
}

export function ScratchPanel({
  displayNumber,
  forceClear,
  reducedMotion,
  disabled,
  onFirstStroke,
  onProgress,
  onCleared,
  children,
}: {
  displayNumber: string;
  /** Clear the foil regardless of scratch progress (Reveal button, reload). */
  forceClear: boolean;
  reducedMotion: boolean;
  /** Foil is shown but scratching is intercepted (e.g. card not yet claimed). */
  disabled?: boolean;
  onFirstStroke: () => void;
  onProgress: (fraction: number) => void;
  onCleared: () => void;
  children?: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const started = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const moves = useRef(0);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => paintFoil(canvas, displayNumber);
    draw();
    document.fonts?.ready.then(() => {
      if (!started.current) draw();
    });
  }, [displayNumber]);

  const finish = useCallback(() => {
    if (cleared) return;
    setCleared(true);
    onCleared();
  }, [cleared, onCleared]);

  useEffect(() => {
    if (forceClear) finish();
  }, [forceClear, finish]);

  const measure = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fraction = clearedFraction(canvas);
    onProgress(fraction);
    if (fraction >= CLEAR_AT) finish();
  };

  const scratchTo = (x: number, y: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = BRUSH;
    ctx.beginPath();
    if (last.current) ctx.moveTo(last.current.x, last.current.y);
    else ctx.moveTo(x, y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, BRUSH / 2, 0, Math.PI * 2);
    ctx.fill();
    last.current = { x, y };
  };

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (cleared) return;
    if (!started.current) {
      started.current = true;
      onFirstStroke();
    }
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = null;
    const { x, y } = pointFrom(e);
    scratchTo(x, y);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (cleared || disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const { x, y } = pointFrom(e);
    scratchTo(x, y);
    if (++moves.current % 6 === 0) measure();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    last.current = null;
    if (!cleared && !disabled) measure();
  };

  return (
    <div className="relative h-[236px] overflow-hidden bg-cream-panel border border-gold-line">
      {children}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 w-full h-full"
        style={{
          touchAction: "none",
          cursor: cleared ? "default" : "crosshair",
          opacity: cleared ? 0 : 1,
          transition: reducedMotion ? "none" : "opacity 450ms ease",
          pointerEvents: cleared ? "none" : "auto",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
}
