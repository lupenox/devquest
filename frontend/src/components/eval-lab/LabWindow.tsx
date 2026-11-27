import { useEffect, useRef, useState } from "react";
import type { EvalSubTab } from "./evalLabConstants";
import type { createLabScene } from "./labScene";

export function LabWindow({station, step, allowMotion}: {station: EvalSubTab; step: number; allowMotion: boolean}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<ReturnType<typeof createLabScene> | null>(null);
  const [off, setOff] = useState(() => window.localStorage?.getItem("eval-lab-motion") === "off");
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const motion = allowMotion && !off && !reduced;
  const location = useRef({station, step});
  location.current = {station, step};
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(!!query?.matches);
    query?.addEventListener?.("change", change);
    return () => query?.removeEventListener?.("change", change);
  }, []);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !window.WebGL2RenderingContext) return;
    let cancelled = false;
    const fallback = () => { el.hidden = true; engine.current?.dispose(); engine.current = null; };
    el.addEventListener("webglcontextlost", fallback);
    import("./labScene").then(({createLabScene}) => {
      if (cancelled) return;
      engine.current = createLabScene(el);
      engine.current.move(location.current.station, location.current.step, false);
      el.hidden = false;
    }).catch(fallback);
    return () => { cancelled = true; el.removeEventListener("webglcontextlost", fallback); fallback(); };
  }, []);
  useEffect(() => engine.current?.move(station, step, motion), [station, step, motion]);
  return <div className="lab-window">
    <canvas hidden ref={canvas} aria-hidden="true" />
    <h2>AI Code Eval Lab</h2>
    <button type="button" className="lab-motion" aria-pressed={!motion} disabled={!allowMotion || reduced}
      onClick={() => {window.localStorage?.setItem("eval-lab-motion", off ? "on" : "off"); setOff(!off);}}>
      Motion {motion ? "on" : "off"}
    </button>
  </div>;
}
