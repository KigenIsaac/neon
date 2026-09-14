"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { Scene, SceneBox } from "@/types";
import {
  ACCENTS, basePlace, planWidths, resolve,
  type Rect, type Size
} from "@/lib/visuals/layout";

function dims() {
  const W = window.innerWidth, H = window.innerHeight;
  const R = Math.min(W, H) * (W < 650 ? 0.18 : 0.22);
  return { W, H, R, cx: W / 2, cy: H / 2 };
}

function safe(v: unknown) { return String(v ?? ""); }

function renderBoxContent(b: SceneBox) {
  const kind = b.kind || "text";
  if (kind === "metric") {
    return (
      <>
        <div className="metric-value">
          {safe(b.value)}
          {b.unit && <span className="metric-unit">{b.unit}</span>}
        </div>
        <div className="metric-label">{b.label || ""}</div>
      </>
    );
  }
  if (kind === "list" || kind === "steps") {
    const cls = kind === "steps" ? "ill-steps" : "ill-list";
    return (
      <ul className={cls}>
        {(b.items || []).slice(0, 8).map((x, i) => <li key={i}>{safe(x)}</li>)}
      </ul>
    );
  }
  if (kind === "chip") {
    return <div className="ill-chip">{b.title || b.body || "Concept"}</div>;
  }
  if (kind === "chart") {
    const vals = (b.values || []).map(Number).filter(Number.isFinite).slice(0, 12);
    const max = Math.max(1, ...vals);
    return (
      <>
        <div className="mini-bars">
          {vals.map((v, i) => (
            <i key={i} style={{ height: `${12 + (88 * v) / max}%` }} />
          ))}
        </div>
        {b.label && <div className="metric-label">{b.label}</div>}
      </>
    );
  }
  if (kind === "progress") {
    const pct = Math.max(0, Math.min(100, Number(b.value) || 0));
    return (
      <>
        <div className="progress-track"><i style={{ width: `${pct}%` }} /></div>
        <div className="metric-label">{`${b.label || "Progress"} ${pct}%`}</div>
      </>
    );
  }
  if (kind === "table") {
    const rows = (b.rows || b.items || []).slice(0, 7);
    return (
      <div className="table-grid">
        {rows.map((r, i) => {
          const pair: [string, string] = Array.isArray(r)
            ? [r[0], r[1]]
            : [(r as any).label, (r as any).value];
          return (
            <div key={i}><span>{safe(pair[0])}</span><b>{safe(pair[1])}</b></div>
          );
        })}
      </div>
    );
  }
  return <p className="ill-body">{b.body || b.text || ""}</p>;
}

export function SceneStage({ scene }: { scene: Scene | null }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRefs = useRef<Array<HTMLElement | null>>([]);

  useLayoutEffect(() => {
    if (!scene || !stageRef.current) return;
    const nodes = boxRefs.current.filter(Boolean) as HTMLElement[];
    if (nodes.length !== scene.boxes.length) return;

    const D = dims();
    const widths = planWidths(scene.layout, scene.boxes.length, D.W);

    nodes.forEach((n, i) => { n.style.width = widths[i] + "px"; });

    const sizes: Size[] = nodes.map((n, i) => ({ w: widths[i], h: n.offsetHeight }));
    const rects: Rect[] = resolve(basePlace(scene.layout, sizes, D), D);

    nodes.forEach((n, i) => {
      n.style.left = rects[i].left + "px";
      n.style.top = rects[i].top + "px";
    });

    requestAnimationFrame(() => {
      nodes.forEach((n, i) => {
        n.style.transitionDelay = `${i * 55}ms`;
        n.classList.add("show");
      });
    });
  }, [scene]);

  useEffect(() => {
    return () => {
      boxRefs.current = [];
    };
  }, [scene]);

  if (!scene) return <div id="stage" ref={stageRef} aria-live="polite" />;

  return (
    <div id="stage" ref={stageRef} aria-live="polite">
      {scene.boxes.map((b, i) => (
        <section
          key={`${i}-${b.title ?? ""}-${b.value ?? ""}`}
          className="ill-wrap"
          ref={(el) => { boxRefs.current[i] = el; }}
        >
          <div
            className="ill-box"
            style={{ ["--accent" as any]: b.accent || ACCENTS[i % ACCENTS.length] }}
          >
            <div className="ill-head">
              <i className="ill-dot" />
              <span className="ill-title">{b.title || "Insight"}</span>
              {b.tag && <span className="ill-tag">{b.tag}</span>}
            </div>
            {renderBoxContent(b)}
          </div>
        </section>
      ))}
    </div>
  );
}