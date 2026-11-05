"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A small fish that swims around the viewport on every page.
 *  - wanders on its own with a burst-and-glide rhythm, turning away from the edges
 *  - on click: swims to the click point; on typing: swims to the text caret
 *  - hovers there briefly, then darts away and goes back to wandering
 *  - swims at two depths: in front of the page, or behind the text and panels (above the water
 *    background), getting smaller, dimmer and softer the deeper it goes. A page can keep it
 *    up front by setting <html data-fish-depth="front"> (the results dashboard does).
 * Purely decorative: pointer-events none, aria-hidden, off for prefers-reduced-motion.
 * The art (public/fish.png) faces left; it is mirrored when swimming right.
 */

type Mode = "wander" | "approach" | "linger" | "flee";

const WIDTH = 68;
const HEIGHT = Math.round((WIDTH * 171) / 256);
const EDGE = 70;
// Content sits at z-index 10, the caustic water below it: "deep" swims between the two
const Z_FRONT = "60";
const Z_DEEP = "5";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Viewport position of the caret in the focused text field, or the field's centre. */
function caretPoint(el: Element | null): { x: number; y: number } | null {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  let x = r.left + r.width / 2;
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) {
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const before = el.value.slice(0, el.selectionStart ?? el.value.length).split("\n").pop() ?? "";
      x = r.left + parseFloat(cs.paddingLeft) + ctx.measureText(before).width - el.scrollLeft;
    }
  } catch {
    // some input types (email, number) don't expose selectionStart: fall back to the centre
  }
  return { x: clamp(x, r.left, r.right), y: r.top + r.height / 2 };
}

export function FishCompanion() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const body = bodyRef.current;
    const img = imgRef.current;
    if (!body || !img) return;

    let x = window.innerWidth * 0.82;
    let y = window.innerHeight * 0.72;
    let vx = -40;
    let vy = 0;
    let heading = Math.PI; // wander heading (radians)
    let face = 1; // +1 = facing left (as drawn), −1 = mirrored; animates through 0 when turning
    let tilt = 0;
    let phase = 0; // tail beat
    let mode: Mode = "wander";
    let modeUntil = 0;
    let tx = 0;
    let ty = 0;
    let fx = 0; // flee destination
    let fy = 0;
    let depth = 0; // 0 = in front of the page, 1 = behind the text
    let depthTarget = 0;
    let nextDive = performance.now() + 5000 + Math.random() * 5000;
    let deep = false;
    let drawnDepth = -1;
    let last = performance.now();
    let raf = 0;

    const curious = (px: number, py: number, now: number) => {
      tx = px;
      ty = py;
      depthTarget = 0; // surface to come and look
      if (mode === "linger") modeUntil = Math.max(modeUntil, now + 600);
      else {
        mode = "approach";
        modeUntil = now + 4000;
      }
    };

    const onPointer = (e: PointerEvent) => curious(e.clientX, e.clientY, performance.now());
    // keydown covers keys like arrows/Enter; input covers paste, autofill and mobile keyboards
    const onKey = (e: KeyboardEvent | Event) => {
      if (e instanceof KeyboardEvent && e.repeat && mode === "linger") return;
      const p = caretPoint(document.activeElement);
      curious(p?.x ?? window.innerWidth / 2, p?.y ?? window.innerHeight / 2, performance.now());
    };

    const startFlee = (now: number) => {
      const away = Math.atan2(y - ty, x - tx) + (Math.random() - 0.5) * 1.2;
      const dist = 260 + Math.random() * 180;
      fx = clamp(x + Math.cos(away) * dist, EDGE, window.innerWidth - EDGE);
      fy = clamp(y + Math.sin(away) * dist, EDGE, window.innerHeight - EDGE);
      mode = "flee";
      modeUntil = now + 1600;
      // Startled fish often dive
      if (Math.random() < 0.55) {
        depthTarget = 1;
        nextDive = now + 3000 + Math.random() * 4000;
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const w = window.innerWidth;
      const h = window.innerHeight;

      let dvx = 0;
      let dvy = 0;
      let response = 2.2; // how quickly velocity follows the desired velocity

      if (mode === "approach") {
        // Aim beside the point so the head, not the middle of the body, ends up there
        const side = x > tx ? 1 : -1;
        const ax = tx + side * WIDTH * 0.42;
        const dx = ax - x;
        const dy = ty - y;
        const d = Math.hypot(dx, dy) || 1;
        const speed = Math.min(430, d * 3.2);
        dvx = (dx / d) * speed;
        dvy = (dy / d) * speed;
        response = 4;
        if (d < 14 || now > modeUntil) {
          mode = "linger";
          modeUntil = now + 700 + Math.random() * 500;
        }
      } else if (mode === "linger") {
        // Nibble: tiny drift toward the point and a gentle bob
        dvx = Math.sin(t * 6) * 10;
        dvy = Math.cos(t * 4.5) * 8;
        response = 5;
        if (now > modeUntil) startFlee(now);
      } else if (mode === "flee") {
        const dx = fx - x;
        const dy = fy - y;
        const d = Math.hypot(dx, dy) || 1;
        const burst = clamp((modeUntil - now) / 1600, 0, 1);
        const speed = Math.min(120 + 420 * burst, d * 4);
        dvx = (dx / d) * speed;
        dvy = (dy / d) * speed;
        response = 6;
        if (d < 20 || now > modeUntil) {
          mode = "wander";
          heading = Math.atan2(vy, vx);
        }
      } else {
        // Smooth wandering: heading drifts with layered sines (no jitter), steered off the edges
        heading += (Math.sin(t * 0.37) * 0.9 + Math.sin(t * 0.13 + 1.3) * 0.6 + Math.sin(t * 1.1) * 0.25) * dt;
        const toCx = w / 2 - x;
        const toCy = h / 2 - y;
        const nearEdge = x < EDGE * 1.6 || x > w - EDGE * 1.6 || y < EDGE * 1.4 || y > h - EDGE * 1.4;
        if (nearEdge) {
          const want = Math.atan2(toCy, toCx);
          const diff = Math.atan2(Math.sin(want - heading), Math.cos(want - heading));
          heading += diff * Math.min(1, dt * 2.5);
        }
        // Burst-and-glide: a few strong tail beats, then coasting
        const pulse = Math.max(0, Math.sin(t * 0.9 + Math.sin(t * 0.27) * 2));
        if (now > nextDive) {
          depthTarget = depthTarget ? 0 : 1;
          nextDive = now + (depthTarget ? 4000 + Math.random() * 6000 : 6000 + Math.random() * 8000);
        }
        const speed = (45 + 70 * pulse * pulse) * (1 - 0.25 * depth); // deeper looks slower (parallax)
        dvx = Math.cos(heading) * speed;
        dvy = Math.sin(heading) * speed * 0.55; // fish mostly swim level
      }

      const k = Math.min(1, response * dt);
      vx += (dvx - vx) * k;
      vy += (dvy - vy) * k;
      x = clamp(x + vx * dt, WIDTH / 2, w - WIDTH / 2);
      y = clamp(y + vy * dt, HEIGHT / 2, h - HEIGHT / 2);

      // Cross the text layer halfway through the dive so the swap hides inside the fade
      if (document.documentElement.dataset.fishDepth === "front") depthTarget = 0;
      depth += (depthTarget - depth) * Math.min(1, dt * 1.4);
      if (depth > 0.5 !== deep) {
        deep = depth > 0.5;
        body.style.zIndex = deep ? Z_DEEP : Z_FRONT;
      }
      if (Math.abs(depth - drawnDepth) > 0.003) {
        drawnDepth = depth;
        body.style.opacity = String(1 - 0.3 * depth);
        body.style.filter = depth > 0.01 ? `blur(${(depth * 1.2).toFixed(2)}px) brightness(${1 - 0.3 * depth}) saturate(${1 - 0.25 * depth})` : "";
      }

      const speed = Math.hypot(vx, vy);
      // Facing: follow the swim direction; while visiting, look at the point
      let faceTarget = face >= 0 ? 1 : -1;
      if (mode === "approach" || mode === "linger") faceTarget = tx < x ? 1 : -1;
      else if (Math.abs(vx) > 8) faceTarget = vx < 0 ? 1 : -1;
      face += (faceTarget - face) * Math.min(1, dt * 7);

      // Nose follows vertical motion
      const tiltTarget = speed > 10 ? clamp(Math.atan2(vy, Math.abs(vx)), -0.5, 0.5) * -Math.sign(faceTarget) : 0;
      tilt += (tiltTarget - tilt) * Math.min(1, dt * 5);

      phase += dt * (3 + speed * 0.045);
      const beat = Math.sin(phase);
      const strength = 0.35 + Math.min(1, speed / 300);
      const bob = mode === "linger" ? Math.sin(t * 3) * 2 : 0;

      body.style.transform = `translate3d(${x - WIDTH / 2}px, ${y - HEIGHT / 2 + bob}px, 0) rotate(${tilt}rad) scale(${1 - 0.22 * depth})`;
      const sx = Math.abs(face) < 0.12 ? 0.12 * Math.sign(face || 1) : face; // never fully flat mid-turn
      img.style.transform = `scaleX(${sx * (1 + beat * 0.025 * strength)}) skewY(${beat * 3 * strength}deg)`;

      raf = requestAnimationFrame(frame);
    };

    const onVisible = () => {
      if (!document.hidden) last = performance.now(); // no jump after returning to the tab
    };

    window.addEventListener("pointerdown", onPointer, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("input", onKey, true);
    document.addEventListener("visibilitychange", onVisible);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("input", onKey, true);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div ref={bodyRef} aria-hidden className="pointer-events-none fixed left-0 top-0 select-none will-change-transform" style={{ width: WIDTH, height: HEIGHT, zIndex: Z_FRONT }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny decorative sprite, transformed every frame */}
      <img
        ref={imgRef}
        src="/fish.png"
        alt=""
        width={WIDTH}
        height={HEIGHT}
        draggable={false}
        className="h-full w-full drop-shadow-[0_6px_14px_rgba(56,225,255,0.25)]"
      />
    </div>
  );
}
