/** Top-down camera: world units <-> screen pixels. */
export class Camera {
  /** World point at the center of the canvas. */
  x = 0;
  y = 0;
  /** Pixels per world unit. */
  zoom = 26;
  width = 1;
  height = 1;
  readonly minZoom = 10;
  readonly maxZoom = 70;

  toScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.zoom + this.width / 2,
      y: (wy - this.y) * this.zoom + this.height / 2,
    };
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.width / 2) / this.zoom + this.x,
      y: (sy - this.height / 2) / this.zoom + this.y,
    };
  }

  /** Zoom by `factor`, keeping the world point under (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.toWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  pan(dxPixels: number, dyPixels: number): void {
    this.x -= dxPixels / this.zoom;
    this.y -= dyPixels / this.zoom;
  }

  /** Keep the view center over the map. */
  clampTo(mapW: number, mapH: number): void {
    this.x = Math.min(mapW, Math.max(0, this.x));
    this.y = Math.min(mapH, Math.max(0, this.y));
  }
}
