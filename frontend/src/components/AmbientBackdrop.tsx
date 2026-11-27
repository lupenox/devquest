import React, { useEffect, useRef, useState } from "react";
import type { MotionMode, ThemeId } from "../types";
import type { AmbientController } from "../ambient/ambientEngine";

interface Props {
  theme: ThemeId;
  motionMode: MotionMode;
  celebrationTick?: number;
}

function canUseWebGL(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  // Skip in jsdom / non-browser test runners cleanly without console noise
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "")) {
    return false;
  }
  try {
    const testCanvas = document.createElement("canvas");
    const gl =
      testCanvas.getContext("webgl2", { powerPreference: "low-power" }) ||
      testCanvas.getContext("webgl", { powerPreference: "low-power" });
    if (!gl) return false;
    // Release temporary probe context immediately
    const loseExt = gl.getExtension("WEBGL_lose_context");
    loseExt?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function AmbientBackdrop({ theme, motionMode, celebrationTick = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<AmbientController | null>(null);
  const themeRef = useRef<ThemeId>(theme);
  const [webglReady, setWebglReady] = useState(false);
  const [autoFallback, setAutoFallback] = useState(false);

  themeRef.current = theme;

  // Reset auto-fallback if user explicitly re-enables full 3D mode
  useEffect(() => {
    if (motionMode !== "full") {
      setAutoFallback(false);
    }
  }, [motionMode]);

  const shouldRunWebGL = motionMode === "full" && !autoFallback;

  useEffect(() => {
    if (!shouldRunWebGL) {
      setWebglReady(false);
      controllerRef.current?.dispose();
      controllerRef.current = null;
      return;
    }

    if (!canUseWebGL()) {
      setWebglReady(false);
      return;
    }

    let cancelled = false;
    let idleId: number | null = null;
    let timerId: number | null = null;

    const boot = async () => {
      try {
        const { createAmbientEngine } = await import("../ambient/ambientEngine");
        if (cancelled || !canvasRef.current) return;
        const ctrl = createAmbientEngine({
          canvas: canvasRef.current,
          theme: themeRef.current,
          onSlowPerformance: () => {
            if (!cancelled) {
              setAutoFallback(true);
            }
          },
        });
        if (!ctrl || cancelled) {
          ctrl?.dispose();
          return;
        }
        controllerRef.current = ctrl;
        setWebglReady(true);
      } catch {
        if (!cancelled) setWebglReady(false);
      }
    };

    // Defer Three.js chunk fetch + WebGL init until after initial UI paint
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof win.requestIdleCallback === "function") {
      idleId = win.requestIdleCallback(() => {
        if (!cancelled) void boot();
      }, { timeout: 220 });
    } else {
      timerId = window.setTimeout(() => {
        if (!cancelled) void boot();
      }, 90);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof win.cancelIdleCallback === "function") {
        win.cancelIdleCallback(idleId);
      }
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      controllerRef.current?.dispose();
      controllerRef.current = null;
      setWebglReady(false);
    };
  }, [shouldRunWebGL]);

  useEffect(() => {
    controllerRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (celebrationTick > 0) {
      controllerRef.current?.triggerPulse();
    }
  }, [celebrationTick]);

  return (
    <div
      className={`ambient-backdrop${webglReady ? " webgl-active" : ""}`}
      data-testid="ambient-backdrop"
      data-mode={motionMode}
      data-webgl={webglReady ? "active" : "css"}
      aria-hidden="true"
    >
      {/* Lightweight CSS Aero atmosphere (instant first paint + Calm/fallback mode) */}
      <div className="ambient-sunbeam" />
      <div className="ambient-aurora-meadow" />
      <div className="ambient-bokeh-layer">
        <span className="ambient-orb orb-1" />
        <span className="ambient-orb orb-2" />
        <span className="ambient-orb orb-3" />
        <span className="ambient-orb orb-4" />
        <span className="ambient-orb orb-5" />
      </div>

      {/* Lazy-loaded Three.js WebGL layer (fades in smoothly when ready) */}
      {shouldRunWebGL && (
        <canvas
          ref={canvasRef}
          className={`ambient-canvas${webglReady ? " ready" : ""}`}
          data-testid="ambient-webgl-canvas"
        />
      )}
    </div>
  );
}
