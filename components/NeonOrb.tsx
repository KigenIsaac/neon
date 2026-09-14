"use client";
import { useEffect, useRef } from "react";

const TAU = Math.PI * 2;

export function NeonOrb() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, R = 0;
    let bgGrad: CanvasGradient, glowGrad: CanvasGradient, glassGrad: CanvasGradient;
    let raf: number | null = null;
    let last = 0, animTime = 0, angleY = 0;
    let mx = 0, my = 0, tmx = 0, tmy = 0;

    const PHI = (1 + Math.sqrt(5)) / 2;
    const BALL = (() => {
      const sets = [
        [0, 1, 3 * PHI],
        [1, 2 + PHI, 2 * PHI],
        [PHI, 2, 2 * PHI + 1]
      ];
      const perms = [[0,1,2],[1,2,0],[2,0,1]];
      const verts: number[][] = [];
      const seen = new Set<string>();
      for (const s of sets) {
        for (const p of perms) {
          const b = [s[p[0]], s[p[1]], s[p[2]]];
          for (let i = -1; i <= 1; i += 2)
            for (let j = -1; j <= 1; j += 2)
              for (let k = -1; k <= 1; k += 2) {
                if ((b[0]===0 && i<0) || (b[1]===0 && j<0) || (b[2]===0 && k<0)) continue;
                const v = [b[0]*i, b[1]*j, b[2]*k];
                const key = v.join("|");
                if (seen.has(key)) continue;
                seen.add(key);
                verts.push(v);
              }
        }
      }
      let maxL = 0;
      for (const v of verts) maxL = Math.max(maxL, Math.hypot(v[0], v[1], v[2]));
      for (const v of verts) { v[0] /= maxL; v[1] /= maxL; v[2] /= maxL; }
      const target = 2 / maxL;
      const eps = target * 0.06;
      const edges: [number, number][] = [];
      for (let i = 0; i < verts.length; i++) {
        for (let j = i + 1; j < verts.length; j++) {
          const dx = verts[i][0] - verts[j][0];
          const dy = verts[i][1] - verts[j][1];
          const dz = verts[i][2] - verts[j][2];
          const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
          if (Math.abs(d - target) < eps) edges.push([i, j]);
        }
      }
      return { verts, edges };
    })();

    const N = BALL.verts.length;
    const PX = new Float32Array(N), PY = new Float32Array(N), PZ = new Float32Array(N);
    const edgeList = BALL.edges.map((e) => ({ a: e[0], b: e[1], z: 0 }));

    const SHADES = Array.from({ length: 16 }, (_, i) => {
      const t = i / 15;
      const a = 0.08 + 0.68 * t * t;
      return {
        c: `rgba(${Math.round(80 + 100*t)},${Math.round(150 + 95*t)},${Math.round(215 + 40*t)},${a.toFixed(3)})`,
        w: 0.5 + 1.7 * t
      };
    });

    const PKT_N = 42;
    const pktA = new Int16Array(PKT_N), pktB = new Int16Array(PKT_N);
    const pktT = new Float32Array(PKT_N), pktSpeed = new Float32Array(PKT_N);
    const respawn = (i: number) => {
      const e = BALL.edges[(Math.random() * BALL.edges.length) | 0];
      pktA[i] = e[0]; pktB[i] = e[1]; pktT[i] = 0;
      pktSpeed[i] = 0.35 + Math.random() * 1.1;
    };
    for (let i = 0; i < PKT_N; i++) { respawn(i); pktT[i] = Math.random(); }

    const vAct = new Float32Array(N);
    let actTimer = 0;
    const SONAR_N = 4;
    const sonarR = new Float32Array(SONAR_N), sonarA = new Float32Array(SONAR_N);

    const makeSprite = (size: number, stops: [number, string][]) => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d")!;
      const gr = g.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
      stops.forEach(([p, col]) => gr.addColorStop(p, col));
      g.fillStyle = gr;
      g.fillRect(0, 0, size, size);
      return c;
    };
    const SPRITE_DOT = makeSprite(64, [
      [0, "rgba(255,255,255,1)"],
      [0.25, "rgba(170,240,255,0.85)"],
      [0.60, "rgba(60,150,255,0.25)"],
      [1, "rgba(20,80,200,0)"]
    ]);
    const SPRITE_VERT = makeSprite(48, [
      [0, "rgba(220,250,255,0.95)"],
      [0.35, "rgba(100,200,255,0.50)"],
      [1, "rgba(30,100,220,0)"]
    ]);

    const stars: Array<{ x: number; y: number; z: number; r: number; p: number; sp: number; c: string }> = [];

    const resize = () => {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      cx = W / 2; cy = H / 2;
      R = Math.min(W, H) * 0.29;

      bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75);
      bgGrad.addColorStop(0, "#08101f"); bgGrad.addColorStop(0.45, "#04070f"); bgGrad.addColorStop(1, "#01020a");

      glowGrad = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 2.6);
      glowGrad.addColorStop(0, "rgba(50,130,240,0.22)");
      glowGrad.addColorStop(0.35, "rgba(30,90,200,0.09)");
      glowGrad.addColorStop(1, "rgba(10,25,70,0)");

      glassGrad = ctx.createRadialGradient(cx - R*0.38, cy - R*0.42, R*0.05, cx, cy, R*1.04);
      glassGrad.addColorStop(0, "rgba(150,220,255,0.10)");
      glassGrad.addColorStop(0.42, "rgba(60,140,255,0.045)");
      glassGrad.addColorStop(0.82, "rgba(20,60,160,0.012)");
      glassGrad.addColorStop(1, "rgba(120,200,255,0.10)");

      for (let i = 0; i < SONAR_N; i++) { sonarR[i] = R * 1.02; sonarA[i] = i / SONAR_N; }

      const n = Math.min(380, Math.round((W * H) / 6800));
      stars.length = 0;
      for (let i = 0; i < n; i++) {
        stars.push({
          x: Math.random() * W, y: Math.random() * H, z: Math.random(),
          r: 0.5 + Math.random() * 1.5, p: Math.random() * TAU,
          sp: 0.4 + Math.random() * 1.6,
          c: Math.random() > 0.86 ? "rgba(160,215,255," : "rgba(255,255,255,"
        });
      }
    };

    const drawStars = (t: number) => {
      const ox = mx * 28, oy = my * 28;
      for (const s of stars) {
        const tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.p);
        ctx.globalAlpha = (0.14 + 0.6 * tw) * (0.35 + 0.65 * s.z);
        ctx.fillStyle = s.c + "1)";
        const sz = s.r * (0.7 + 0.6 * tw);
        ctx.fillRect(s.x + ox * s.z, s.y + oy * s.z, sz, sz);
      }
      ctx.globalAlpha = 1;
    };

    const drawHudRing = (t: number) => {
      const r = R * 1.22, rot = t * 0.08;
      ctx.strokeStyle = "rgba(60,140,220,0.10)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
      const ticks = 60;
      ctx.beginPath();
      for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * TAU + rot;
        const long = i % 5 === 0 ? 9 : 4;
        const c = Math.cos(a), s = Math.sin(a);
        ctx.moveTo(cx + c * r, cy + s * r);
        ctx.lineTo(cx + c * (r + long), cy + s * (r + long));
      }
      ctx.strokeStyle = "rgba(80,180,255,0.22)";
      ctx.stroke();
    };

    const drawOrbits = (t: number) => {
      ctx.save(); ctx.translate(cx, cy);
      for (let i = 0; i < 3; i++) {
        const rot = t * (0.18 + i * 0.11) + i * 2.0;
        const tilt = 0.22 + i * 0.14;
        const rr = R * (1.32 + i * 0.10);
        ctx.save(); ctx.rotate(rot);
        ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * tilt, 0, 0, TAU);
        ctx.strokeStyle = "rgba(80,180,255,0.12)"; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    };

    const drawSonar = (dt: number) => {
      for (let i = 0; i < SONAR_N; i++) {
        sonarA[i] -= dt * 0.5;
        if (sonarA[i] <= 0) { sonarA[i] = 1; sonarR[i] = R * 1.02; }
        else sonarR[i] += dt * R * 0.6;
        ctx.beginPath();
        ctx.arc(cx, cy, sonarR[i], 0, TAU);
        ctx.strokeStyle = `rgba(90,190,255,${(sonarA[i] * 0.25).toFixed(3)})`;
        ctx.lineWidth = 1; ctx.stroke();
      }
    };

    const updateActivity = (dt: number) => {
      for (let i = 0; i < N; i++) vAct[i] *= 0.94;
      actTimer -= dt;
      if (actTimer <= 0) {
        actTimer = 0.05 + Math.random() * 0.1;
        const n = 2 + ((Math.random() * 3) | 0);
        for (let k = 0; k < n; k++) vAct[(Math.random() * N) | 0] = 0.6 + Math.random() * 0.4;
      }
    };

    const updatePackets = (dt: number) => {
      for (let i = 0; i < PKT_N; i++) {
        pktT[i] += pktSpeed[i] * dt;
        if (pktT[i] >= 1) respawn(i);
      }
    };

    const drawGlobe = (t: number) => {
      const CAM = 3.0;
      const pulse = 0.72 + 0.28 * Math.sin(t * 1.6);

      ctx.globalAlpha = pulse;
      ctx.fillStyle = glowGrad;
      ctx.beginPath(); ctx.arc(cx, cy, R * 2.6, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;

      const ay = angleY + mx * 0.35;
      const ax = -0.28 + my * 0.30;
      const cyA = Math.cos(ay), syA = Math.sin(ay);
      const cxA = Math.cos(ax), sxA = Math.sin(ax);

      for (let i = 0; i < N; i++) {
        const v = BALL.verts[i];
        const x1 = v[0] * cyA + v[2] * syA;
        const z1 = -v[0] * syA + v[2] * cyA;
        const y1 = v[1];
        const y2 = y1 * cxA - z1 * sxA;
        const z2 = y1 * sxA + z1 * cxA;
        const sc = CAM / (CAM - z2);
        PX[i] = cx + x1 * R * sc;
        PY[i] = cy + y2 * R * sc;
        PZ[i] = z2;
      }

      ctx.fillStyle = glassGrad;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.04, 0, TAU); ctx.fill();

      for (const e of edgeList) e.z = (PZ[e.a] + PZ[e.b]) * 0.5;
      edgeList.sort((p, q) => p.z - q.z);

      ctx.lineCap = "round";
      for (const e of edgeList) {
        const sh = SHADES[(((e.z + 1) * 0.5 * 15) | 0)];
        ctx.strokeStyle = sh.c; ctx.lineWidth = sh.w;
        ctx.beginPath();
        ctx.moveTo(PX[e.a], PY[e.a]); ctx.lineTo(PX[e.b], PY[e.b]);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < N; i++) {
        const a = vAct[i];
        if (a < 0.02) continue;
        const tz = (PZ[i] + 1) * 0.5;
        const size = (8 + 20 * a) * (0.6 + tz * 0.6);
        ctx.globalAlpha = a * (0.4 + tz * 0.6);
        ctx.drawImage(SPRITE_VERT, PX[i] - size/2, PY[i] - size/2, size, size);
      }
      for (let i = 0; i < PKT_N; i++) {
        const a = pktA[i], b = pktB[i], tt = pktT[i];
        const x = PX[a] + (PX[b] - PX[a]) * tt;
        const y = PY[a] + (PY[b] - PY[a]) * tt;
        const z = PZ[a] + (PZ[b] - PZ[a]) * tt;
        const tz = (z + 1) * 0.5;
        const size = 10 + tz * 14;
        ctx.globalAlpha = 0.35 + tz * 0.65;
        ctx.drawImage(SPRITE_DOT, x - size/2, y - size/2, size, size);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      const scanA = t * 1.1;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.07, scanA, scanA + 0.55);
      ctx.strokeStyle = "rgba(80,180,255,0.10)"; ctx.lineWidth = 14; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.07, scanA, scanA + 0.55);
      ctx.strokeStyle = "rgba(190,240,255,0.55)"; ctx.lineWidth = 1.5; ctx.stroke();
    };

    const frame = (now: number) => {
      if (!last) last = now;
      let dt = (now - last) / 1000; last = now;
      if (dt > 0.05) dt = 0.05;
      const motion = reduce ? 0.22 : 1;
      const vdt = dt * motion;
      animTime += vdt;
      angleY += vdt * 0.35;
      mx += (tmx - mx) * 0.05;
      my += (tmy - my) * 0.05;

      updateActivity(vdt);
      updatePackets(vdt);

      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);
      drawStars(animTime);
      drawSonar(vdt);
      drawHudRing(animTime);
      drawOrbits(animTime);
      drawGlobe(animTime);

      raf = requestAnimationFrame(frame);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!W || !H) return;
      tmx = (e.clientX / W - 0.5) * 2;
      tmy = (e.clientY / H - 0.5) * 2;
    };

    const onVisibility = () => {
      if (document.hidden) { if (raf !== null) { cancelAnimationFrame(raf); raf = null; } }
      else { last = 0; if (raf === null) raf = requestAnimationFrame(frame); }
    };

    resize();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas id="bg-canvas" ref={canvasRef} />;
}