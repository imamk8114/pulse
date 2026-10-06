import { createDecimated, Decimated, minMaxBucket } from '../engine/downsample';
import { Deploy } from '../shared/types';
import { fmtDateTime, fmtNum } from '../state/format';
import { logTicks, niceTicks, tickLabel, timeTicks } from './axis';
import { AxisInteraction } from './interaction';
import { LayeredCanvas } from './layer';
import { frameStats } from './scheduler';
import { getTheme } from './theme';

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  values: Float32Array;
  hidden: boolean;
}
export interface Threshold {
  value: number;
  label: string;
  color?: string;
}
export interface Band {
  from: number;
  to: number;
  color: string;
  label?: string;
}
export interface Timeline {
  t0: number;
  step: number;
  count: number;
}
export interface ChartHost {
  view(): { from: number; to: number };
  timeline(): Timeline;
  deploys(): Deploy[];
  hover(): { t: number | null; service: string | null };
  setHover(t: number | null, service: string | null): void;
  brush(from: number, to: number): void;
  pan(dt: number): void;
  zoom(anchor: number, factor: number): void;
  reset(): void;
  live(): void;
  markerClick(d: Deploy): void;
  /** Highlight pulse for the guided tour. */
  pulseMarkers(): boolean;
}

const PAD = { l: 46, r: 12, t: 8, b: 20 };

export class TimeSeriesChart extends LayeredCanvas {
  private series: ChartSeries[] = [];
  private log = false;
  private thresholds: Threshold[] = [];
  private bands: Band[] = [];
  private previewBands: Band[] = [];
  private unit = '';
  private dec: Decimated[] = [];
  private y0 = 0;
  private y1 = 1;
  private floor = 0.01;
  private sel: { x0: number; x1: number } | null = null;
  private markers: Array<{ x: number; d: Deploy }> = [];
  private hoverMarker: Deploy | null = null;
  private tip: HTMLDivElement;
  private tipHtml = '';
  private ix: AxisInteraction;

  constructor(container: HTMLElement, private host: ChartHost, label: string) {
    super(container);
    this.over.tabIndex = 0;
    this.over.setAttribute('role', 'img');
    this.over.setAttribute('aria-label', `${label} time series chart. Arrow keys pan, plus and minus zoom, End returns to live, 0 resets.`);
    this.over.style.cursor = 'crosshair';
    this.tip = document.createElement('div');
    this.tip.className = 'chart-tip';
    this.tip.setAttribute('role', 'tooltip');
    this.tip.hidden = true;
    this.root.appendChild(this.tip);
    this.ix = new AxisInteraction(
      this.over,
      { plot: () => ({ left: PAD.l, width: Math.max(10, this.w - PAD.l - PAD.r) }), view: () => host.view() },
      {
        hover: (t, x, y) => {
          if (t == null) {
            this.hoverMarker = null;
            host.setHover(null, null);
            return;
          }
          this.hoverMarker = this.markerAt(x, y);
          host.setHover(t, this.nearestSeries(t, y));
          this.invalidateOverlay();
        },
        brushPreview: (x0, x1) => {
          this.sel = x0 == null ? null : { x0, x1 };
          this.invalidateOverlay();
        },
        brush: (a, b) => host.brush(a, b),
        pan: (dt) => host.pan(dt),
        zoom: (a, f) => host.zoom(a, f),
        reset: () => host.reset(),
        live: () => host.live(),
        click: (x, y) => {
          const m = this.markerAt(x, y);
          if (m) host.markerClick(m);
        },
        cursorChange: (m) => (this.over.style.cursor = m),
      },
    );
  }

  /* ----- configuration ----- */
  setSeries(s: ChartSeries[]) {
    this.series = s;
    while (this.dec.length < s.length) this.dec.push(createDecimated(4096));
    this.invalidate();
  }
  setLog(v: boolean) {
    if (v !== this.log) {
      this.log = v;
      this.invalidate();
    }
  }
  setUnit(u: string) {
    this.unit = u;
  }
  setThresholds(t: Threshold[]) {
    this.thresholds = t;
    this.invalidate();
  }
  setBands(b: Band[]) {
    this.bands = b;
    this.invalidate();
  }
  setPreviewBands(b: Band[]) {
    this.previewBands = b;
    this.invalidate();
  }

  /* ----- geometry ----- */
  private plotW() {
    return Math.max(10, this.w - PAD.l - PAD.r);
  }
  private plotH() {
    return Math.max(10, this.h - PAD.t - PAD.b);
  }
  private xOf(t: number, v = this.host.view()) {
    return PAD.l + ((t - v.from) / (v.to - v.from)) * this.plotW();
  }
  private yOf(val: number) {
    if (this.log) {
      const l = Math.log10(Math.max(val, this.floor));
      return PAD.t + this.plotH() * (1 - (l - this.y0) / (this.y1 - this.y0));
    }
    return PAD.t + this.plotH() * (1 - (val - this.y0) / (this.y1 - this.y0));
  }
  private valueAt(s: ChartSeries, t: number): number {
    const tl = this.host.timeline();
    const i = Math.min(tl.count - 1, Math.max(0, Math.round((t - tl.t0) / tl.step)));
    return s.values[i];
  }
  private nearestSeries(t: number, y: number): string | null {
    let best: string | null = null;
    let bd = Infinity;
    for (const s of this.series) {
      if (s.hidden) continue;
      const d = Math.abs(this.yOf(this.valueAt(s, t)) - y);
      if (d < bd) {
        bd = d;
        best = s.id;
      }
    }
    return best;
  }
  private markerAt(x: number, y: number): Deploy | null {
    if (y > PAD.t + 22) return null;
    for (const m of this.markers) if (Math.abs(m.x - x) <= 8) return m.d;
    return null;
  }

  /* ----- drawing ----- */
  protected drawBase(ctx: CanvasRenderingContext2D) {
    const th = getTheme();
    const view = this.host.view();
    const tl = this.host.timeline();
    const pw = this.plotW();
    const ph = this.plotH();
    const span = view.to - view.from;
    if (tl.count < 2 || span <= 0) return;
    const i0 = Math.max(0, Math.floor((view.from - tl.t0) / tl.step) - 1);
    const i1 = Math.min(tl.count, Math.ceil((view.to - tl.t0) / tl.step) + 2);

    // 1. decimate by pixel width and find the y domain
    let dmin = Infinity;
    let dmax = -Infinity;
    let minPos = Infinity;
    const buckets = Math.max(1, Math.floor(pw));
    this.series.forEach((s, k) => {
      if (s.hidden) return;
      const d = minMaxBucket(s.values, i0, i1, buckets, this.dec[k]);
      frameStats.pointsLastFrame += d.length;
      for (let j = 0; j < d.length; j++) {
        const v = d.val[j];
        if (v < dmin) dmin = v;
        if (v > dmax) dmax = v;
        if (v > 0 && v < minPos) minPos = v;
      }
    });
    if (!isFinite(dmin)) {
      dmin = 0;
      dmax = 1;
      minPos = 0.1;
    }
    let tmax = dmax;
    for (const t of this.thresholds) if (t.value <= dmax * 2.5) tmax = Math.max(tmax, t.value);
    if (this.log) {
      this.floor = Math.max(1e-3, minPos * 0.7);
      this.y0 = Math.floor(Math.log10(this.floor) * 2) / 2;
      this.y1 = Math.max(this.y0 + 1, Math.ceil(Math.log10(Math.max(tmax, this.floor * 10)) * 2) / 2);
    } else {
      this.y0 = 0;
      this.y1 = Math.max(tmax * 1.1, 1e-6);
      if (this.unit === '%' && this.y1 > 100) this.y1 = 100;
    }

    // 2. bands (incidents, deploy windows)
    ctx.font = '11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
    for (const b of this.bands) {
      const x0 = Math.max(PAD.l, this.xOf(b.from, view));
      const x1 = Math.min(PAD.l + pw, this.xOf(b.to, view));
      if (x1 <= x0) continue;
      ctx.fillStyle = b.color;
      ctx.fillRect(x0, PAD.t, x1 - x0, ph);
    }
    // 3. grid + y labels
    ctx.lineWidth = 1;
    ctx.strokeStyle = th.grid;
    ctx.fillStyle = th.textDim;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const yt = this.log ? logTicks(this.y0, this.y1) : niceTicks(this.y0, this.y1, Math.max(2, Math.floor(ph / 38)));
    ctx.beginPath();
    for (const v of yt) {
      const y = Math.round(this.yOf(v)) + 0.5;
      if (y < PAD.t - 1 || y > PAD.t + ph + 1) continue;
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(PAD.l + pw, y);
    }
    ctx.stroke();
    for (const v of yt) {
      const y = this.yOf(v);
      if (y < PAD.t - 1 || y > PAD.t + ph + 1) continue;
      ctx.fillText(fmtNum(v).replace(/\.00$/, ''), PAD.l - 6, y);
    }
    // x ticks
    const { step, ticks } = timeTicks(view.from, view.to, Math.max(2, Math.floor(pw / 78)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.beginPath();
    for (const t of ticks) {
      const x = Math.round(this.xOf(t, view)) + 0.5;
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, PAD.t + ph);
    }
    ctx.stroke();
    for (const t of ticks) ctx.fillText(tickLabel(t, step), this.xOf(t, view), PAD.t + ph + 5);

    // 4. preview bands from the alert editor
    for (const b of this.previewBands) {
      const x0 = Math.max(PAD.l, this.xOf(b.from, view));
      const x1 = Math.min(PAD.l + pw, this.xOf(b.to, view));
      if (x1 <= x0) continue;
      ctx.fillStyle = b.color;
      ctx.fillRect(x0, PAD.t, x1 - x0, ph);
    }

    // 5. series, clipped to the plot
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, PAD.t - 2, pw, ph + 4);
    ctx.clip();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.5;
    const pxPerSample = (pw / span) * tl.step;
    this.series.forEach((s, k) => {
      if (s.hidden) return;
      const d = this.dec[k];
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      for (let j = 0; j < d.length; j++) {
        const x = PAD.l + ((tl.t0 + d.idx[j] * tl.step - view.from) / span) * pw;
        const y = this.yOf(d.val[j]);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (pxPerSample > 7) {
        ctx.fillStyle = s.color;
        for (let j = 0; j < d.length; j++) {
          const x = PAD.l + ((tl.t0 + d.idx[j] * tl.step - view.from) / span) * pw;
          ctx.beginPath();
          ctx.arc(x, this.yOf(d.val[j]), 2.2, 0, 6.3);
          ctx.fill();
        }
      }
    });
    ctx.restore();

    // 6. thresholds
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    for (const t of this.thresholds) {
      const y = Math.round(this.yOf(t.value)) + 0.5;
      if (y < PAD.t || y > PAD.t + ph) continue;
      ctx.strokeStyle = t.color ?? th.danger;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(PAD.l + pw, y);
      ctx.stroke();
      ctx.fillStyle = t.color ?? th.danger;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(t.label, PAD.l + pw - 4, y - 2);
    }
    ctx.setLineDash([]);

    // 7. deploy markers
    this.markers = [];
    const pulse = this.host.pulseMarkers();
    for (const d of this.host.deploys()) {
      if (d.ts < view.from || d.ts > view.to) continue;
      const x = Math.round(this.xOf(d.ts, view)) + 0.5;
      const col = d.kind === 'rollback' ? th.ok : th.warn;
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.75;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, PAD.t + 10);
      ctx.lineTo(x, PAD.t + ph);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x - 6, PAD.t);
      ctx.lineTo(x + 6, PAD.t);
      ctx.lineTo(x, PAD.t + 10);
      ctx.closePath();
      ctx.fill();
      if (pulse) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, PAD.t + 4, 11, 0, 6.3);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      this.markers.push({ x, d });
    }
    // axis baseline
    ctx.strokeStyle = th.axis;
    ctx.beginPath();
    ctx.moveTo(PAD.l, PAD.t + ph + 0.5);
    ctx.lineTo(PAD.l + pw, PAD.t + ph + 0.5);
    ctx.stroke();
  }

  protected drawOver(ctx: CanvasRenderingContext2D) {
    const th = getTheme();
    const view = this.host.view();
    const h = this.host.hover();
    const pw = this.plotW();
    const ph = this.plotH();
    // brush selection
    if (this.sel) {
      const x0 = Math.min(this.sel.x0, this.sel.x1);
      const x1 = Math.max(this.sel.x0, this.sel.x1);
      ctx.fillStyle = 'rgba(56,189,248,0.16)';
      ctx.fillRect(x0, PAD.t, x1 - x0, ph);
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, PAD.t + 0.5, x1 - x0, ph - 1);
    }
    const show = h.t != null && h.t >= view.from && h.t <= view.to && !this.sel;
    if (!show) {
      this.setTip(null);
      this.over.style.cursor = this.over.style.cursor === 'grabbing' ? 'grabbing' : 'crosshair';
      return;
    }
    const t = h.t as number;
    const x = Math.round(this.xOf(t, view)) + 0.5;
    ctx.strokeStyle = th.textDim;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, PAD.t);
    ctx.lineTo(x, PAD.t + ph);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const rows: Array<{ s: ChartSeries; v: number }> = [];
    for (const s of this.series) {
      if (s.hidden) continue;
      const v = this.valueAt(s, t);
      rows.push({ s, v });
      const y = this.yOf(v);
      const hl = h.service === s.id;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(x, y, hl ? 4.5 : 3, 0, 6.3);
      ctx.fill();
      ctx.strokeStyle = th.bg;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // highlighted series drawn thicker on top (re-using the decimated cache from the base pass)
    const hk = this.series.findIndex((s) => s.id === h.service && !s.hidden);
    if (hk >= 0) {
      const d = this.dec[hk];
      const tl = this.host.timeline();
      const span = view.to - view.from;
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.l, PAD.t - 2, pw, ph + 4);
      ctx.clip();
      ctx.strokeStyle = this.series[hk].color;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let j = 0; j < d.length; j++) {
        const px = PAD.l + ((tl.t0 + d.idx[j] * tl.step - view.from) / span) * pw;
        const py = this.yOf(d.val[j]);
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }
    // tooltip
    rows.sort((a, b) => b.v - a.v);
    let html = `<div class="tt-time">${fmtDateTime(Math.round(t / 1000) * 1000)}</div>`;
    if (this.hoverMarker) {
      const d = this.hoverMarker;
      html += `<div class="tt-deploy">${d.kind === 'rollback' ? 'Rollback' : 'Deploy'} ${d.service} ${d.version}<br><span>click for details</span></div>`;
    }
    for (const r of rows.slice(0, 8)) {
      html += `<div class="tt-row${h.service === r.s.id ? ' hl' : ''}"><i style="background:${r.s.color}"></i><span>${r.s.label}</span><b>${fmtNum(r.v, this.unit)}</b></div>`;
    }
    this.setTip(html, x);
  }

  private setTip(html: string | null, x = 0) {
    if (html == null) {
      if (!this.tip.hidden) this.tip.hidden = true;
      this.tipHtml = '';
      return;
    }
    if (html !== this.tipHtml) {
      this.tip.innerHTML = html;
      this.tipHtml = html;
    }
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth || 160;
    const left = x + 14 + tw > this.w ? x - 14 - tw : x + 14;
    this.tip.style.transform = `translate(${Math.max(PAD.l, left)}px, ${PAD.t + 4}px)`;
  }

  destroy() {
    this.ix.destroy();
    super.destroy();
  }
}
