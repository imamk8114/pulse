/**
 * Pointer / wheel / keyboard handling for any chart whose x axis is time.
 * It only translates gestures into callbacks; the host decides what they mean.
 */
export interface PlotBox {
  left: number;
  width: number;
}
export interface AxisHost {
  plot(): PlotBox;
  view(): { from: number; to: number };
}
export interface AxisCallbacks {
  hover(t: number | null, x: number, y: number): void;
  brushPreview(x0: number | null, x1: number): void;
  brush(from: number, to: number): void;
  pan(dtMs: number): void;
  zoom(anchorT: number, factor: number): void;
  reset(): void;
  click(x: number, y: number): void;
  live(): void;
  cursorChange?(mode: 'default' | 'grabbing' | 'crosshair'): void;
}

export class AxisInteraction {
  private down: { x: number; y: number; id: number; mode: 'brush' | 'pan'; moved: boolean; lastX: number } | null = null;
  private off: Array<() => void> = [];

  constructor(private el: HTMLElement, private host: AxisHost, private cb: AxisCallbacks) {
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
      el.addEventListener(t, f as EventListener, o);
      this.off.push(() => el.removeEventListener(t, f as EventListener));
    };
    on('pointerdown', (e) => this.onDown(e));
    on('pointermove', (e) => this.onMove(e));
    on('pointerup', (e) => this.onUp(e));
    on('pointercancel', () => this.cancel());
    on('pointerleave', () => {
      if (!this.down) cb.hover(null, 0, 0);
    });
    on('wheel', (e) => this.onWheel(e), { passive: false });
    on('dblclick', () => cb.reset());
    on('keydown', (e) => this.onKey(e));
  }

  private rel(e: MouseEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private tAt(x: number) {
    const p = this.host.plot();
    const v = this.host.view();
    return v.from + ((x - p.left) / p.width) * (v.to - v.from);
  }
  private inPlot(x: number) {
    const p = this.host.plot();
    return x >= p.left && x <= p.left + p.width;
  }

  private onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const { x, y } = this.rel(e);
    if (!this.inPlot(x)) return;
    this.el.setPointerCapture(e.pointerId);
    this.down = { x, y, id: e.pointerId, mode: e.shiftKey ? 'pan' : 'brush', moved: false, lastX: x };
    if (e.shiftKey) this.cb.cursorChange?.('grabbing');
  }
  private onMove(e: PointerEvent) {
    const { x, y } = this.rel(e);
    const d = this.down;
    if (!d) {
      this.cb.hover(this.inPlot(x) ? this.tAt(x) : null, x, y);
      return;
    }
    if (Math.abs(x - d.x) > 3) d.moved = true;
    const p = this.host.plot();
    const cx = Math.min(Math.max(x, p.left), p.left + p.width);
    if (d.mode === 'brush') {
      if (d.moved) this.cb.brushPreview(d.x, cx);
      this.cb.hover(this.tAt(cx), cx, y);
    } else {
      const v = this.host.view();
      const dt = -((x - d.lastX) / p.width) * (v.to - v.from);
      d.lastX = x;
      if (dt !== 0) this.cb.pan(dt);
    }
  }
  private onUp(e: PointerEvent) {
    const d = this.down;
    if (!d) return;
    this.down = null;
    try {
      this.el.releasePointerCapture(d.id);
    } catch {
      /* already released */
    }
    this.cb.cursorChange?.('crosshair');
    const { x, y } = this.rel(e);
    if (d.mode === 'brush') {
      this.cb.brushPreview(null, 0);
      const p = this.host.plot();
      const cx = Math.min(Math.max(x, p.left), p.left + p.width);
      if (d.moved && Math.abs(cx - d.x) >= 6) {
        const a = this.tAt(Math.min(d.x, cx));
        const b = this.tAt(Math.max(d.x, cx));
        this.cb.brush(a, b);
      } else if (!d.moved) this.cb.click(x, y);
    }
  }
  private cancel() {
    this.down = null;
    this.cb.brushPreview(null, 0);
  }
  private onWheel(e: WheelEvent) {
    const { x } = this.rel(e);
    if (!this.inPlot(x)) return;
    e.preventDefault();
    const mult = e.deltaMode === 1 ? 16 : 1;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const p = this.host.plot();
      const v = this.host.view();
      this.cb.pan((e.deltaX * mult / p.width) * (v.to - v.from));
      return;
    }
    const factor = Math.exp(e.deltaY * mult * 0.0017);
    this.cb.zoom(this.tAt(x), factor);
  }
  private onKey(e: KeyboardEvent) {
    const v = this.host.view();
    const span = v.to - v.from;
    const mid = (v.from + v.to) / 2;
    switch (e.key) {
      case 'ArrowLeft':
        this.cb.pan(-span * (e.shiftKey ? 0.5 : 0.15));
        break;
      case 'ArrowRight':
        this.cb.pan(span * (e.shiftKey ? 0.5 : 0.15));
        break;
      case 'ArrowUp':
      case '+':
      case '=':
        this.cb.zoom(mid, 0.7);
        break;
      case 'ArrowDown':
      case '-':
        this.cb.zoom(mid, 1.4);
        break;
      case 'End':
        this.cb.live();
        break;
      case '0':
      case 'Escape':
        this.cb.reset();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  destroy() {
    this.off.forEach((o) => o());
  }
}
