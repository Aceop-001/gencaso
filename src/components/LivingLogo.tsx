"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Logo } from "./Logo";

/**
 * The header jellyfish. Touch it and it bolts out of the logo:
 *  - mouse: it stays out for as long as the cursor sits on its home, swimming nearby and
 *    dodging the cursor whenever it comes close; move the cursor off its home and it
 *    springs back into the logo
 *  - tap / Enter / Space: a short run (three quick bell pulses along a gentle curve) and back
 * Decorative only; does nothing under prefers-reduced-motion.
 */

const SIZE = 30; // docked size in the header
const GROW = 1.7; // scale while out
const PERIOD = 0.45; // seconds per bell pulse
const POWER = 4400; // thrust on each bell contraction (px/s²)
const DRAG = 2.6;
const RUN_MS = 1200; // the getaway run: ~3 pulses (and the whole trip for taps/keys)
const CURVE = 0.9; // rad/s: the run bends a little, left or right at random
const SPRING = 7; // return spring stiffness (rad/s): critically damped, settles in well under a second
const HOME_PAD = 18; // the "home" hover zone is the logo plus this margin (px)
const LEAVE_MS = 250; // cursor must be off home this long before it comes back
const FEAR_RADIUS = 140; // the cursor this close makes it dodge (px)

const WALL = 120; // near an edge, an escape direction pointing into it is bounced back toward the page

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Startle = { x: number; y: number; byMouse: boolean };

export function LivingLogo() {
  const dockRef = useRef<HTMLSpanElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Where the touch came from (viewport px), or null when docked
  const [from, setFrom] = useState<Startle | null>(null);

  const startle = (s: Startle) => {
    if (from || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setFrom(s);
  };

  useEffect(() => {
    if (!from) return;
    const dock = dockRef.current;
    const body = bodyRef.current;
    if (!dock || !body) return;

    // Track the cursor while the jellyfish is out (null once it leaves the window)
    let cursor: { x: number; y: number } | null = from.byMouse ? { x: from.x, y: from.y } : null;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse") cursor = { x: e.clientX, y: e.clientY };
    };
    const onLeaveWindow = () => (cursor = null);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeaveWindow);

    const homeRect = () => dock.getBoundingClientRect();
    const onHome = () => {
      if (!cursor) return false;
      const r = homeRect();
      return cursor.x > r.left - HOME_PAD && cursor.x < r.right + HOME_PAD && cursor.y > r.top - HOME_PAD && cursor.y < r.bottom + HOME_PAD;
    };

    const r0 = homeRect();
    let x = r0.left + r0.width / 2;
    let y = r0.top + r0.height / 2;
    let vx = 0;
    let vy = 0;
    // Heading for an escape direction (dx, dy), bounced off nearby edges so it never pins itself
    // against a wall (the logo sits in the top-left corner). Heading: 0 = bell up, clockwise.
    const fleeHeading = (dx: number, dy: number) => {
      if (x < WALL && dx < 0) dx = -dx * 0.6;
      if (x > window.innerWidth - WALL && dx > 0) dx = -dx * 0.6;
      if (y < WALL && dy < 0) dy = -dy * 0.6;
      if (y > window.innerHeight - WALL && dy > 0) dy = -dy * 0.6;
      return Math.atan2(dx, -dy);
    };
    // Flee directly away from the touch, but always somewhat down into the page (the header is at the top)
    const len = Math.hypot(x - from.x, y - from.y) || 1;
    let theta = fleeHeading((x - from.x) / len, Math.max((y - from.y) / len, 0.55));
    let rot = theta;
    let scale = 1;
    let phase: "out" | "return" = "out";
    const curve = Math.random() < 0.5 ? -CURVE : CURVE;
    const t0 = performance.now();
    let outUntil = t0 + (from.byMouse ? 600 : RUN_MS); // minimum time out
    let lastOnHome = t0;
    let goal = { x, y: y + 200 };
    let nextGoal = t0 + RUN_MS;
    let last = t0;
    let raf = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const r = homeRect();
      const hx = r.left + r.width / 2;
      const hy = r.top + r.height / 2;
      const dist = Math.hypot(hx - x, hy - y);
      if (onHome()) lastOnHome = now;
      const cursorGap = cursor ? Math.hypot(x - cursor.x, y - cursor.y) : Infinity;
      const scared = cursorGap < FEAR_RADIUS;

      if (phase === "out") {
        // Mouse: stay out while the cursor holds its home; taps/keys: just the run
        const stay = from.byMouse && now - lastOnHome < LEAVE_MS;
        if (now > outUntil && !stay && !scared) phase = "return";
      } else if (scared && dist > 60) {
        // Cursor got in the way on the way home: dodge again for a moment
        phase = "out";
        outUntil = now + 500;
      }

      if (phase === "out") {
        let power = POWER;
        if (scared && cursor) {
          // Dodge: turn hard away from the cursor
          const away = fleeHeading(x - cursor.x, y - cursor.y);
          theta += clamp(wrap(away - theta), -1, 1) * 9 * dt;
          power = POWER * 1.25;
        } else if (now - t0 < RUN_MS) {
          theta += curve * dt; // the getaway run
        } else {
          // Hang around below the header while it waits, drifting between nearby spots
          if (now > nextGoal) {
            goal = { x: clamp(hx + (Math.random() - 0.2) * 520, 60, w - 60), y: clamp(hy + 140 + Math.random() * 260, 100, h - 60) };
            nextGoal = now + 1400 + Math.random() * 1200;
          }
          const want = Math.atan2(goal.x - x, -(goal.y - y));
          theta += clamp(wrap(want - theta), -1, 1) * 3 * dt;
          power = POWER * 0.55;
        }
        const pulse = ((now - t0) / 1000 / PERIOD) % 1;
        if (pulse > 0.12 && pulse < 0.38) {
          // Thrust during the bell contraction (matches .jelly-pulse)
          vx += Math.sin(theta) * power * dt;
          vy += -Math.cos(theta) * power * dt;
        }
        const drag = Math.exp(-DRAG * dt);
        vx *= drag;
        vy *= drag;
      } else {
        // Critically damped spring straight back to the logo: quick, no overshoot
        vx += ((hx - x) * SPRING * SPRING - 2 * SPRING * vx) * dt;
        vy += ((hy - y) * SPRING * SPRING - 2 * SPRING * vy) * dt;
        // Bell leads the way home, turning upright as it arrives
        theta = dist > 25 ? Math.atan2(vx, -vy) : theta + wrap(0 - theta) * Math.min(1, dt * 10);
        if (dist < 0.8 && Math.hypot(vx, vy) < 8) {
          setFrom(null);
          return;
        }
      }
      x = clamp(x + vx * dt, 20, w - 20);
      y = clamp(y + vy * dt, 10, h - 20);

      rot += wrap(theta - rot) * Math.min(1, dt * 14);
      const grown = phase === "out" ? 1 : clamp((dist - 10) / 120, 0, 1);
      scale += (1 + (GROW - 1) * grown - scale) * Math.min(1, dt * 8);

      const box = SIZE * GROW;
      body.style.transform = `translate3d(${x - box / 2}px, ${y - box / 2}px, 0) rotate(${rot}rad) scale(${scale / GROW})`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeaveWindow);
    };
  }, [from]);

  return (
    <button
      type="button"
      aria-label="GENCASO jellyfish"
      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
      onPointerEnter={(e) => e.pointerType === "mouse" && startle({ x: e.clientX, y: e.clientY, byMouse: true })}
      onPointerDown={(e) => startle({ x: e.clientX, y: e.clientY, byMouse: e.pointerType === "mouse" })}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        startle({ x: r.left, y: r.top, byMouse: false }); // from the top-left: dodges down and right
      }}
    >
      <span ref={dockRef} className="relative inline-flex shrink-0 items-center justify-center" style={{ width: SIZE, height: SIZE }}>
        {from ? (
          // Empty berth while it's out
          <span className="h-[22px] w-[22px] rounded-full border border-dashed border-cyan/30" />
        ) : (
          <Logo size={SIZE} animated />
        )}
      </span>
      {from &&
        createPortal(
          <div
            ref={bodyRef}
            aria-hidden
            className="pointer-events-none fixed left-0 top-0 z-50"
            style={{ width: SIZE * GROW, height: SIZE * GROW, transform: "translate3d(-200px,-200px,0)" }}
          >
            <Logo size={SIZE * GROW} animated glow pulseSeconds={PERIOD} strokeWidth={2.6} />
          </div>,
          document.body,
        )}
    </button>
  );
}
