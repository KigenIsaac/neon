export const ACCENTS = ["#5fd0ff", "#38e8c8", "#a78bfa", "#f5a97f", "#ff7aa2"];

export interface Rect { left: number; top: number; w: number; h: number; }
export interface Size { w: number; h: number; }

export function reserveTop() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--stage-reserve-top");
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : 118;
}
export function reserveBottom() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--stage-reserve-bottom");
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : 200;
}

export function planWidths(layout: string, n: number, W: number) {
  const mobile = W < 650;
  const gap = 12;
  const max = W - 28;
  if (mobile) {
    if (layout === "metrics" || layout === "compare" || layout === "quad") {
      return Array(n).fill(Math.min(max, Math.max(120, (max - gap) / 2)));
    }
    return Array(n).fill(Math.min(max, 420));
  }
  if (layout === "hero") return [Math.min(440, W * 0.44)];
  if (layout === "compare") return Array(n).fill(Math.min(300, W * 0.27));
  if (layout === "trio") return Array(n).fill(Math.min(250, W * 0.23));
  if (layout === "metrics") return Array(n).fill(Math.min(210, W / (n + 2)));
  if (layout === "quad") return Array(n).fill(Math.min(210, W * 0.19));
  if (layout === "radial") return Array(n).fill(Math.min(165, W * 0.15));
  if (layout === "rail") return Array(n).fill(Math.min(220, W * 0.19));
  return Array(n).fill(Math.min(320, W * 0.30));
}

export function basePlace(
  layout: string,
  sizes: Size[],
  D: { W: number; H: number; R: number; cx: number; cy: number }
): Rect[] {
  const { W, H, R, cx, cy } = D;
  const pad = 14, gap = 14;
  const out: Rect[] = [];
  const top = reserveTop();
  const bottom = reserveBottom();
  const maxH = Math.max(...sizes.map((s) => s.h), 0);
  const rowY = Math.max(top, H - bottom - maxH);

  const row = (total: number, y: number) => {
    const totalW = sizes.reduce((s, x) => s + x.w, 0) + gap * (total - 1);
    let x = Math.max(pad, (W - totalW) / 2);
    sizes.forEach((s) => { out.push({ left: x, top: y, w: s.w, h: s.h }); x += s.w + gap; });
  };

  if (W < 650) {
    const twoCol = layout === "compare" || layout === "metrics" || layout === "quad";
    if (twoCol) {
      let x = pad, y = H - bottom;
      sizes.forEach((s, i) => {
        if (i && i % 2 === 0) { x = pad; y -= sizes[i - 2].h + 10; }
        out.push({ left: x, top: y - s.h, w: s.w, h: s.h });
        x += s.w + 10;
      });
    } else {
      let y = H - bottom;
      sizes.forEach((s) => {
        y -= s.h + 10;
        out.push({ left: (W - s.w) / 2, top: y, w: s.w, h: s.h });
      });
    }
    return out;
  }

  if (layout === "hero") {
    const s = sizes[0];
    out.push({ left: (W - s.w) / 2, top: Math.max(top, cy - R - s.h - 26), w: s.w, h: s.h });
    return out;
  }
  if (layout === "compare") {
    const y = Math.max(top + 40, cy);
    sizes.forEach((s, i) => {
      out.push({ left: i === 0 ? pad : W - pad - s.w, top: y - s.h / 2, w: s.w, h: s.h });
    });
    return out;
  }
  if (layout === "trio") {
    const s0 = sizes[0];
    out.push({ left: (W - s0.w) / 2, top, w: s0.w, h: s0.h });
    for (let i = 1; i < sizes.length; i++) {
      const s = sizes[i];
      out.push({
        left: i === 1 ? pad : W - pad - s.w,
        top: Math.min(H - bottom - s.h, cy + R * 0.15),
        w: s.w, h: s.h
      });
    }
    return out;
  }
  if (layout === "metrics" || layout === "rail") { row(sizes.length, rowY); return out; }
  if (layout === "quad") {
    const cols = 2;
    let y = top;
    for (let i = 0; i < sizes.length; i++) {
      const s = sizes[i];
      const col = i % cols;
      if (col === 0 && i) y += sizes[i - 2].h + gap;
      out.push({ left: col === 0 ? pad : W - pad - s.w, top: y, w: s.w, h: s.h });
    }
    return out;
  }
  if (layout === "radial") {
    sizes.forEach((s, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / sizes.length;
      const maxRx = Math.max(0, W / 2 - pad - s.w / 2 - 20);
      const maxRy = Math.max(0, Math.min(cy - top, H - bottom - cy) - s.h / 2 - 20);
      let rr = R + s.h * 0.8 + 40;
      rr = Math.min(rr, Math.hypot(maxRx, maxRy));
      out.push({
        left: cx + Math.cos(a) * rr - s.w / 2,
        top: cy + Math.sin(a) * rr - s.h / 2,
        w: s.w, h: s.h
      });
    });
    return out;
  }
  row(sizes.length, rowY);
  return out;
}

export function resolve(
  rects: Rect[],
  D: { W: number; H: number; R: number; cx: number; cy: number }
): Rect[] {
  const { W, H, R, cx, cy } = D;
  const keep = R + 26;
  const pad = 12, gap = 8;

  rects.forEach((r) => {
    for (let k = 0; k < 10; k++) {
      const qx = Math.max(r.left, Math.min(cx, r.left + r.w));
      const qy = Math.max(r.top, Math.min(cy, r.top + r.h));
      const d = Math.hypot(qx - cx, qy - cy);
      if (d >= keep) break;
      let ux = r.left + r.w / 2 - cx;
      let uy = r.top + r.h / 2 - cy;
      let l = Math.hypot(ux, uy);
      if (l < 1) { ux = 0; uy = -1; l = 1; }
      r.left += (ux / l) * (keep - d + 8);
      r.top += (uy / l) * (keep - d + 8);
    }
  });

  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const ox = Math.min(a.left + a.w, b.left + b.w) - Math.max(a.left, b.left);
        const oy = Math.min(a.top + a.h, b.top + b.h) - Math.max(a.top, b.top);
        if (ox <= -gap || oy <= -gap) continue;
        if (ox < 0 || oy < 0) continue;
        moved = true;
        const px = (ox + gap) / 2, py = (oy + gap) / 2;
        if (px < py) {
          const dir = a.left + a.w / 2 < b.left + b.w / 2 ? -1 : 1;
          a.left += dir * px; b.left -= dir * px;
        } else {
          const dir = a.top + a.h / 2 < b.top + b.h / 2 ? -1 : 1;
          a.top += dir * py; b.top -= dir * py;
        }
      }
    }
    rects.forEach((r) => {
      r.left = Math.max(pad, Math.min(W - pad - r.w, r.left));
      r.top = Math.max(pad, Math.min(H - pad - r.h, r.top));
    });
    if (!moved) break;
  }

  rects.forEach((r) => {
    for (let k = 0; k < 6; k++) {
      const qx = Math.max(r.left, Math.min(cx, r.left + r.w));
      const qy = Math.max(r.top, Math.min(cy, r.top + r.h));
      const d = Math.hypot(qx - cx, qy - cy);
      if (d >= keep - 4) break;
      let ux = r.left + r.w / 2 - cx;
      let uy = r.top + r.h / 2 - cy;
      let l = Math.hypot(ux, uy);
      if (l < 1) { ux = 0; uy = -1; l = 1; }
      r.left += (ux / l) * (keep - d + 6);
      r.top += (uy / l) * (keep - d + 6);
    }
    r.left = Math.max(pad, Math.min(W - pad - r.w, r.left));
    r.top = Math.max(pad, Math.min(H - pad - r.h, r.top));
  });

  return rects;
}