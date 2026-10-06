import { fmtDateTime } from '../state/format';
import { niceTicks, tickLabel, timeTicks } from './axis';
import { AxisInteraction } from './interaction';
import { LayeredCanvas } from './layer';
import { getTheme } from './theme';
import { ChartHost } from './timeseries';

export interface HistData {
  from: number;
  to: number;
  hist: Uint32Array;
  errHist: Uint32Array;
}
const PAD = { l: 46, r: 12, t: 6, b: 20 };

/** Brushable bar histogram of matching logs; shares the crosshair and brush semantics with the line charts. */
export class LogHistogram extends LayeredCanvas {
  private d: HistData | null = null;
  private ix: AxisInteraction;
  private sel: { x0: number; x1: number } | null = null;
  private tip: HTMLDivElement;

  constructor(container: HTMLElement, private host: ChartHost) {
    super(container);
    this.over.tabIndex = 0;
    this.over.setAttribute('role', 'img');
    this.over.setAttribute('aria-label', 'Histogram of matching log lines over time. Drag to zoom the time range; arrow keys pan.');
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
        hover: (t) => {
          host.setHover(t, null);
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
        click: () => undefined,
      },
    );
  }

  setData(d: HistData | null) {
    this.d = d;
    this.invalidate();
  }

  protected drawBase(ctx: CanvasRenderingContext2D) {
    const th = getTheme();
    const view = this.host.view();
    const pw = Math.max(10, this.w - PAD.l - PAD.r);
    const ph = Math.max(10, this.h - PAD.t - PAD.b);
    const span = view.to - view.from;
    ctx.font = '11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
    let max = 1;
    if (this.d) for (let i = 0; i < this.d.hist.length; i++) if (this.d.hist[i] > max) max = this.d.hist[i];
    const yt = niceTicks(0, max * 1.05, 3);
    const ymax = max * 1.05;
    ctx.strokeStyle = th.grid;
    ctx.fillStyle = th.textDim;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.beginPath();
    for (const v of yt) {
      const y = Math.round(PAD.t + ph * (1 - v / ymax)) + 0.5;
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(PAD.l + pw, y);
    }
    ctx.stroke();
    for (const v of yt) ctx.fillText(v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v), PAD.l - 6, PAD.t + ph * (1 - v / ymax));
    const { step, ticks } = timeTicks(view.from, view.to, Math.max(2, Math.floor(pw / 78)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of ticks) ctx.fillText(tickLabel(t, step), PAD.l + ((t - view.from) / span) * pw, PAD.t + ph + 5);
    if (!this.d) return;
    const { hist, errHist, from, to } = this.d;
    const n = hist.length;
    const bw = ((to - from) / n / span) * pw;
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, PAD.t, pw, ph);
    ctx.clip();
    for (let i = 0; i < n; i++) {
      const x = PAD.l + ((from + ((to - from) * i) / n - view.from) / span) * pw;
      if (x + bw < PAD.l || x > PAD.l + pw) continue;
      const h = (hist[i] / ymax) * ph;
      const eh = (errHist[i] / ymax) * ph;
      ctx.fillStyle = th.accent;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x + 0.5, PAD.t + ph - h, Math.max(1, bw - 1), h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = th.danger;
      ctx.fillRect(x + 0.5, PAD.t + ph - eh, Math.max(1, bw - 1), eh);
    }
    ctx.restore();
    ctx.strokeStyle = th.axis;
    ctx.beginPath();
    ctx.moveTo(PAD.l, PAD.t + ph + 0.5);
    ctx.lineTo(PAD.l + pw, PAD.t + ph + 0.5);
    ctx.stroke();
  }

  protected drawOver(ctx: CanvasRenderingContext2D) {
    const th = getTheme();
    const view = this.host.view();
    const pw = Math.max(10, this.w - PAD.l - PAD.r);
    const ph = Math.max(10, this.h - PAD.t - PAD.b);
    if (this.sel) {
      const x0 = Math.min(this.sel.x0, this.sel.x1);
      const x1 = Math.max(this.sel.x0, this.sel.x1);
      ctx.fillStyle = 'rgba(56,189,248,0.16)';
      ctx.fillRect(x0, PAD.t, x1 - x0, ph);
      ctx.strokeStyle = th.accent;
      ctx.strokeRect(x0 + 0.5, PAD.t + 0.5, x1 - x0, ph - 1);
    }
    const h = this.host.hover();
    if (h.t == null || h.t < view.from || h.t > view.to || this.sel) {
      this.tip.hidden = true;
      return;
    }
    const x = Math.round(PAD.l + ((h.t - view.from) / (view.to - view.from)) * pw) + 0.5;
    ctx.strokeStyle = th.textDim;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, PAD.t);
    ctx.lineTo(x, PAD.t + ph);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (this.d) {
      const b = Math.floor(((h.t - this.d.from) / (this.d.to - this.d.from)) * this.d.hist.length);
      if (b >= 0 && b < this.d.hist.length) {
        this.tip.innerHTML = `<div class="tt-time">${fmtDateTime(h.t)}</div><div class="tt-row"><i style="background:${th.accent}"></i><span>matches</span><b>${this.d.hist[b]}</b></div><div class="tt-row"><i style="background:${th.danger}"></i><span>errors</span><b>${this.d.errHist[b]}</b></div>`;
        this.tip.hidden = false;
        const tw = this.tip.offsetWidth || 150;
        this.tip.style.transform = `translate(${x + 14 + tw > this.w ? x - 14 - tw : x + 14}px, ${PAD.t + 4}px)`;
      }
    }
  }

  destroy() {
    this.ix.destroy();
    super.destroy();
  }
}
