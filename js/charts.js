/* ============================================================
   EcoGridCharts — a ~3 KB dependency-free canvas line chart.
   Deliberately tiny (green software): no chart framework, no
   animations, one shared hover tooltip, DPR-aware rendering.
   ============================================================ */
(function () {
  "use strict";

  const PAD = { l: 52, r: 14, t: 14, b: 30 };

  function prep(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600;
    const cssH = canvas.clientHeight || 260;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    return { ctx, w: cssW, h: cssH };
  }

  function tickLabel(v) {
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(Math.abs(v) % 1000 ? 1 : 0) + "k";
    if (Math.abs(v) >= 100) return String(Math.round(v));
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(2);
  }

  /* series: [{ label, color, points: [{x, y}], dash? }]
     opts:   { xLabels, yMax, yTicks, unit, zeroBase, onHover(values|null, px, py) } */
  function line(canvas, series, opts) {
    opts = opts || {};
    const { ctx, w, h } = prep(canvas);
    const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b;

    let yMin = 0, yMax = opts.yMax;
    if (yMax == null) {
      yMax = 0;
      series.forEach(s => s.points.forEach(p => { if (p.y > yMax) yMax = p.y; }));
      yMax *= 1.1;
      if (!yMax) yMax = 1;
    }
    const yTicks = opts.yTicks || 4;
    const xLabels = opts.xLabels || [];
    const n = xLabels.length || 1;

    const X = i => PAD.l + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
    const Y = v => PAD.t + ph - ((v - yMin) / (yMax - yMin)) * ph;

    const css = getComputedStyle(document.documentElement);
    const lineCol = css.getPropertyValue("--line").trim() || "#22314e";
    const faintCol = css.getPropertyValue("--faint").trim() || "#5d7095";
    const textCol = css.getPropertyValue("--muted").trim() || "#8ba0bf";

    ctx.font = "11px " + (css.getPropertyValue("--mono").trim() || "monospace");
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let t = 0; t <= yTicks; t++) {
      const v = yMin + ((yMax - yMin) * t) / yTicks;
      const y = Y(v);
      ctx.strokeStyle = lineCol; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
      ctx.fillStyle = faintCol;
      ctx.fillText(tickLabel(v), PAD.l - 8, y);
    }

    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const skip = Math.ceil(n / 12);
    for (let i = 0; i < n; i += skip) {
      ctx.fillStyle = textCol;
      ctx.fillText(String(xLabels[i] != null ? xLabels[i] : i), X(i), PAD.t + ph + 8);
    }

    series.forEach(s => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(s.dash ? [5, 4] : []);
      ctx.lineJoin = "round";
      ctx.beginPath();
      s.points.forEach((p, i) => { if (i === 0) ctx.moveTo(X(p.x), Y(p.y)); else ctx.lineTo(X(p.x), Y(p.y)); });
      ctx.stroke();
      ctx.setLineDash([]);
    });

    if (typeof opts.onHover === "function") {
      const hit = ev => {
        const r = canvas.getBoundingClientRect();
        const mx = ev.clientX - r.left;
        if (mx < PAD.l - 6 || mx > w - PAD.r + 6) return opts.onHover(null);
        const frac = (mx - PAD.l) / pw;
        const i = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
        const vals = series.map(s => {
          const p = s.points[i];
          return { label: s.label, color: s.color, x: xLabels[i] != null ? xLabels[i] : i, y: p ? p.y : null };
        });
        opts.onHover({ i, x: xLabels[i] != null ? xLabels[i] : i, vals }, mx, ev.clientY - r.top);
      };
      canvas.addEventListener("mousemove", hit);
      canvas.addEventListener("mouseleave", () => opts.onHover(null));
    }
  }

  function tooltip(container, html, px, py) {
    let el = container.querySelector(".chart-tip");
    if (!html) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("div");
      el.className = "chart-tip";
      container.appendChild(el);
    }
    el.innerHTML = html;
    el.style.left = Math.min(px + 14, container.clientWidth - el.offsetWidth - 8) + "px";
    el.style.top = Math.max(4, py - el.offsetHeight - 12) + "px";
  }

  window.EcoGridCharts = { line, tooltip };
})();
