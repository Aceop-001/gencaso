"use client";

import { useRef, useState } from "react";
import { fmtMoney, fmtPct, fmtSigned, shortAddr } from "@/lib/format";
import { SOCIAL } from "@/lib/social";
import type { CountryCode } from "@/lib/tax";
import { Flag } from "./Flag";

export interface TaxCardData {
  country: CountryCode;
  countryName: string;
  taxUsd: number;
  /** e.g. "≈ ¥19,204,903.33" — omitted for USD countries */
  localLine?: string;
  yearLabel: string;
  /** Short tax-year id for the file name, e.g. FY2025-26 */
  yearId: string;
  inProgress: boolean;
  netTradingResult: number;
  taxableUsd: number | null;
  effective: number | null;
  address: string;
  isDemo: boolean;
  moduleVersion: string;
  provisional?: string;
}

const W = 1200;
const H = 675;
const SCALE = 2;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** CSS font-family of a next/font variable, e.g. --font-serif */
const family = (v: string, fallback: string) => (getComputedStyle(document.body).getPropertyValue(v).trim() || "") + `, ${fallback}`;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Draws the card from the figures on screen only. Nothing is recalculated here. */
async function drawCard(d: TaxCardData, flagSvg: string | null): Promise<Blob> {
  const serif = family("--font-serif", "Georgia, serif");
  const sans = family("--font-geist-sans", "system-ui, sans-serif");
  const mono = family("--font-geist-mono", "ui-monospace, monospace");
  await Promise.all([document.fonts.load(`italic 64px ${serif}`), document.fonts.load(`600 64px ${sans}`), document.fonts.load(`400 20px ${mono}`)]).catch(() => undefined);

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);

  // Background: the hero card's midnight gradient with blue and violet light
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0a1430");
  bg.addColorStop(1, "#04081a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = (x: number, y: number, r: number, c: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  glow(0, 0, 720, "rgba(61,123,255,.30)");
  glow(W, H, 640, "rgba(139,108,255,.22)");
  glow(W * 0.78, H * 0.2, 380, "rgba(56,225,255,.10)");
  ctx.strokeStyle = "rgba(120,180,255,.26)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, 14, 14, W - 28, H - 28, 34);
  ctx.stroke();

  // Header: jellyfish + wordmark, and the disclaimer pill
  const [mark, fish] = await Promise.all([loadImage("/brand/gencaso-mark.svg").catch(() => null), loadImage("/fish.png").catch(() => null)]);
  if (mark) ctx.drawImage(mark, 56, 46, 54, 54);
  ctx.fillStyle = "#ffffff";
  ctx.font = `italic 44px ${serif}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Gencaso", 118, 88);

  ctx.font = `500 13px ${sans}`;
  ctx.letterSpacing = "2.5px";
  const pill = "ESTIMATE · NOT TAX ADVICE";
  const pw = ctx.measureText(pill).width + 34;
  roundRect(ctx, W - 56 - pw, 52, pw, 36, 18);
  ctx.strokeStyle = "rgba(120,160,255,.28)";
  ctx.stroke();
  ctx.fillStyle = "#a3b1d6";
  ctx.fillText(pill, W - 56 - pw + 17, 75);

  // Eyebrow: flag + country
  let x = 64;
  if (flagSvg) {
    const flag = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(flagSvg)).catch(() => null);
    if (flag) {
      ctx.save();
      roundRect(ctx, x, 168, 36, 24, 4);
      ctx.clip();
      ctx.drawImage(flag, x, 168, 36, 24);
      ctx.restore();
      x += 50;
    }
  }
  ctx.fillStyle = "#38e1ff";
  ctx.font = `500 17px ${sans}`;
  ctx.letterSpacing = "4.5px";
  ctx.fillText(`ESTIMATED TAX · ${d.countryName.toUpperCase()}`, x, 187);

  // The amount
  ctx.letterSpacing = "-4px";
  ctx.fillStyle = "#e8eeff";
  let size = 132;
  const amount = fmtMoney(d.taxUsd);
  ctx.font = `600 ${size}px ${sans}`;
  while (ctx.measureText(amount).width > 860 && size > 70) ctx.font = `600 ${(size -= 4)}px ${sans}`;
  ctx.fillText(amount, 58, 330);
  const aw = ctx.measureText(amount).width;
  ctx.letterSpacing = "0px";
  ctx.font = `400 28px ${sans}`;
  ctx.fillStyle = "#6a7aa6";
  ctx.fillText("USD", 58 + aw + 18, 330);

  ctx.font = `400 21px ${mono}`;
  ctx.fillStyle = "#a3b1d6";
  ctx.fillText([d.localLine, d.yearLabel + (d.inProgress ? " · in progress" : "")].filter(Boolean).join(" · "), 64, 378);

  if (d.provisional) {
    ctx.font = `500 16px ${sans}`;
    ctx.fillStyle = "#ffc566";
    ctx.fillText(`Provisional: ${d.provisional}`.slice(0, 110), 64, 410);
  }

  // Three figures
  const stats: [string, string, string?][] = [
    ["NET TRADING RESULT", fmtSigned(d.netTradingResult), d.netTradingResult >= 0 ? "#3ee6a8" : "#ff6b8a"],
    ["TAXABLE AMOUNT", d.taxableUsd != null ? fmtMoney(d.taxableUsd) : "—"],
    ["EFFECTIVE RATE", d.effective != null ? fmtPct(d.effective) : "n/a"],
  ];
  const sw = (W - 128 - 36) / 3;
  stats.forEach(([label, value, color], i) => {
    const sx = 64 + i * (sw + 18);
    roundRect(ctx, sx, 446, sw, 104, 22);
    ctx.fillStyle = "rgba(12,20,44,.62)";
    ctx.fill();
    ctx.strokeStyle = "rgba(120,160,255,.14)";
    ctx.stroke();
    ctx.font = `500 13px ${sans}`;
    ctx.letterSpacing = "2.5px";
    ctx.fillStyle = "#6a7aa6";
    ctx.fillText(label, sx + 22, 482);
    ctx.letterSpacing = "0px";
    ctx.font = `500 30px ${mono}`;
    ctx.fillStyle = color ?? "#e8eeff";
    ctx.fillText(value, sx + 22, 526);
  });

  // Footer: wallet, module, builder
  ctx.font = `400 16px ${mono}`;
  ctx.fillStyle = d.isDemo ? "#ffc566" : "#6a7aa6";
  ctx.fillText(`${d.isDemo ? "Demo wallet · mock data" : /\s/.test(d.address) ? d.address : shortAddr(d.address)} · module ${d.moduleVersion} · for comparison only`, 64, 616);
  ctx.textAlign = "right";
  ctx.font = `500 17px ${sans}`;
  ctx.fillStyle = "#a3b1d6";
  ctx.fillText(`gencaso · ${SOCIAL.x.handle}`, W - 64, 616);
  ctx.textAlign = "left";

  if (fish) {
    ctx.save();
    ctx.shadowColor = "rgba(56,225,255,.45)";
    ctx.shadowBlur = 30;
    ctx.drawImage(fish, W - 64 - 150, 170, 150, 100);
    ctx.restore();
  }

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"));
}

/** "Download tax card" — a 2400×1350 PNG of the current estimate, made in the browser. */
export function TaxCardButton({ data }: { data: TaxCardData }) {
  const flagRef = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const run = async () => {
    setState("busy");
    try {
      const svg = flagRef.current?.querySelector("svg");
      const blob = await drawCard(data, svg ? new XMLSerializer().serializeToString(svg) : null);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gencaso-tax-card-${data.country.toLowerCase()}-${data.yearId}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setState("idle");
    } catch {
      setState("error");
    }
  };
  return (
    <>
      <span ref={flagRef} className="hidden" aria-hidden><Flag code={data.country} size={36} /></span>
      <button
        onClick={run}
        disabled={state === "busy"}
        className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(100deg,#3d7bff,#38e1ff)] px-4 py-2 text-xs font-medium text-[#03101f] shadow-[0_8px_24px_-8px_rgba(56,225,255,.6)] transition hover:brightness-110 disabled:opacity-60"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
        </svg>
        {state === "busy" ? "Making card…" : state === "error" ? "Try again" : "Download tax card"}
      </button>
    </>
  );
}
