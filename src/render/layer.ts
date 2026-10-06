import { Drawable, forget, markDirty } from './scheduler';

/** Two stacked canvases (heavy base layer, cheap overlay) with DPR-correct sizing. */
export abstract class LayeredCanvas implements Drawable {
  readonly root: HTMLDivElement;
  readonly base: HTMLCanvasElement;
  readonly over: HTMLCanvasElement;
  protected bctx: CanvasRenderingContext2D;
  protected octx: CanvasRenderingContext2D;
  protected w = 0;
  protected h = 0;
  protected dpr = 1;
  protected baseDirty = true;
  protected overDirty = true;
  protected visible = true;
  private ro: ResizeObserver;
  private io: IntersectionObserver;
  protected cleanups: Array<() => void> = [];

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'lc-root';
    this.base = document.createElement('canvas');
    this.over = document.createElement('canvas');
    this.over.className = 'lc-over';
    this.base.setAttribute('aria-hidden', 'true');
    this.root.append(this.base, this.over);
    container.appendChild(this.root);
    this.bctx = this.base.getContext('2d')!;
    this.octx = this.over.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.root);
    this.io = new IntersectionObserver((es) => {
      const v = es.some((e) => e.isIntersecting);
      if (v && !this.visible) this.invalidate();
      this.visible = v;
    });
    this.io.observe(this.root);
    const onTheme = () => this.invalidate();
    window.addEventListener('pulse-theme', onTheme);
    this.cleanups.push(() => window.removeEventListener('pulse-theme', onTheme));
    this.resize();
  }

  resize() {
    const r = this.root.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(10, Math.round(r.width));
    const h = Math.max(10, Math.round(r.height));
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    for (const c of [this.base, this.over]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    this.invalidate();
  }

  invalidate() {
    this.baseDirty = true;
    this.overDirty = true;
    markDirty(this);
  }
  invalidateOverlay() {
    this.overDirty = true;
    markDirty(this);
  }

  draw() {
    if (!this.visible) {
      // Skipped while off-screen; IntersectionObserver re-invalidates when it scrolls back.
      return;
    }
    if (this.baseDirty) {
      this.bctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.bctx.clearRect(0, 0, this.w, this.h);
      this.drawBase(this.bctx);
      this.baseDirty = false;
    }
    if (this.overDirty) {
      this.octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.octx.clearRect(0, 0, this.w, this.h);
      this.drawOver(this.octx);
      this.overDirty = false;
    }
  }

  protected abstract drawBase(ctx: CanvasRenderingContext2D): void;
  protected abstract drawOver(ctx: CanvasRenderingContext2D): void;

  destroy() {
    forget(this);
    this.ro.disconnect();
    this.io.disconnect();
    this.cleanups.forEach((c) => c());
    this.root.remove();
  }
}
