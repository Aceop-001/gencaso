"use client";

import { useEffect, useRef, useState } from "react";

/**
 * WebGL2 animated water caustics behind the landing hero.
 *
 * Adapted from OpenDesign's official "Caustic Pool" plugin (MIT License,
 * https://github.com/nexu-io/open-design/tree/main/plugins/_official/examples/webgl-caustic-pool).
 * The caustic network function is the plugin's; GENCASO changes:
 *  - midnight-blue / cyan palette with a faint violet edge, lower intensity for text readability
 *  - renders at reduced resolution and pauses when hidden or scrolled away
 *  - honours prefers-reduced-motion (single static frame)
 *  - static CSS fallback when WebGL2 is unavailable
 *  - no click-to-ripple: the water flows on its own and never reacts to input
 *  - pointer-events: none — never blocks interaction
 */

const VERT = `#version 300 es
void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 u_res; uniform float u_time;
#define TAU 6.28318530718
float caustic(vec2 uv){
  float t=u_time*0.32+23.0;
  vec2 p=mod(uv*TAU, TAU)-250.0;
  vec2 i=p; float c=1.0; float inten=0.005;
  for(int n=0;n<5;n++){
    float tt=t*(1.0-(3.5/float(n+1)));
    i=p+vec2(cos(tt-i.x)+sin(tt+i.y), sin(tt-i.y)+cos(tt+i.x));
    c+=1.0/length(vec2(p.x/(sin(i.x+tt)/inten), p.y/(cos(i.y+tt)/inten)));
  }
  c/=5.0; c=1.17-pow(c,1.4);
  return pow(abs(c),8.0);
}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res; uv.x*=u_res.x/u_res.y;
  vec2 p=(gl_FragCoord.xy-0.5*u_res)/u_res.y;
  float c=caustic(uv*1.25);
  vec3 deep=vec3(0.004,0.010,0.032), shallow=vec3(0.020,0.060,0.150);
  vec3 col=mix(deep,shallow, smoothstep(1.1,-0.4,length(p-vec2(0.0,0.25))));
  col+=vec3(0.10,0.42,0.95)*c*0.55;            // electric-blue filaments
  col+=vec3(0.45,0.90,1.00)*pow(c,1.8)*0.28;    // cyan hot cores
  col=mix(col, col+vec3(0.10,0.04,0.22)*0.6, smoothstep(0.2,1.2,abs(p.x)));   // faint violet edges
  col*=0.55+0.55*smoothstep(1.35,0.05,length(p));
  col=col/(col+0.8);
  col+=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9,78.2)))*43758.5)-0.5)*0.018;
  o=vec4(pow(max(col,0.0),vec3(0.9)),1.0);
}`;

/**
 * variant "hero": fills the landing hero, fading into the page below.
 * variant "ambient": fixed behind the results dashboard, with a dark overlay so
 * tables and figures stay readable.
 * Both are non-interactive — the water just keeps flowing.
 */
export function CausticBackground({ active = true, variant = "hero" }: { active?: boolean; variant?: "hero" | "ambient" }) {
  const ambient = variant === "ambient";
  const ref = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl || gl.isContextLost()) {
      setFallback(true);
      return;
    }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("link");
    } catch {
      setFallback(true);
      return;
    }
    gl.useProgram(program);
    const uRes = gl.getUniformLocation(program, "u_res");
    const uTime = gl.getUniformLocation(program, "u_time");

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = true;
    let raf = 0;
    const t0 = performance.now();

    const resize = () => {
      // Render at reduced resolution — caustics are soft, so this is visually lossless and cheap.
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.5;
      const w = Math.max(1, Math.floor(canvas.clientWidth * scale));
      const h = Math.max(1, Math.floor(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    const draw = (now: number) => {
      resize();
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, reduced ? 4 : (now - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden || !activeRef.current) return;
      draw(now);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (reduced) return draw(performance.now());
      if (!raf) {
        raf = requestAnimationFrame(frame);
      }
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
    });
    io.observe(canvas);
    const onVis = () => !document.hidden && start();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("resize", start);
    start();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", start);
      // No forced loseContext(): the canvas may be re-initialised (React dev double-mount),
      // and a lost context can't be reused. The browser frees it when the canvas is removed.
      gl.deleteProgram(program);
    };
  }, []);

  useEffect(() => {
    // Resume the loop when re-activated
    if (active) window.dispatchEvent(new Event("resize"));
  }, [active]);

  return (
    <div aria-hidden className={`pointer-events-none inset-0 overflow-hidden ${ambient ? "fixed z-0" : "absolute"}`}>
      {fallback ? (
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% 30%, rgba(30,80,200,.28), transparent 70%), radial-gradient(ellipse 50% 40% at 80% 70%, rgba(110,80,255,.12), transparent 70%), #03060f",
          }}
        />
      ) : (
        <canvas ref={ref} className="absolute inset-0 h-full w-full" />
      )}
      {/* Readability overlays */}
      {ambient ? (
        <div className="absolute inset-0 bg-[rgba(3,6,15,0.38)]" />
      ) : (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_45%,rgba(3,6,15,0.55),rgba(3,6,15,0.15)_70%)]" />
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-b from-transparent to-bg" />
        </>
      )}
    </div>
  );
}
