import { DEFS } from './defs';
import type { Entity } from './types';

/** Buildings and resources occupy squares; units are circles. */
export const isSquare = (e: Entity): boolean => DEFS[e.def].category !== 'unit';

export const radiusOf = (e: Entity): number => DEFS[e.def].radius;

export const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(bx - ax, by - ay);

/** Gap between the shapes of two entities (0 or negative when touching/overlapping). */
export function edgeDist(a: Entity, b: Entity): number {
  const ra = radiusOf(a);
  const rb = radiusOf(b);
  const sa = isSquare(a);
  const sb = isSquare(b);
  if (!sa && !sb) return dist(a.x, a.y, b.x, b.y) - ra - rb;
  if (sa && sb) {
    const gx = Math.abs(a.x - b.x) - ra - rb;
    const gy = Math.abs(a.y - b.y) - ra - rb;
    if (gx > 0 && gy > 0) return Math.hypot(gx, gy);
    return Math.max(gx, gy);
  }
  const [circle, square] = sa ? [b, a] : [a, b];
  return pointToSquare(circle.x, circle.y, square.x, square.y, radiusOf(square)) - radiusOf(circle);
}

/** Distance from a point to an axis-aligned square (0 if inside). */
export function pointToSquare(px: number, py: number, sx: number, sy: number, half: number): number {
  const dx = Math.max(Math.abs(px - sx) - half, 0);
  const dy = Math.max(Math.abs(py - sy) - half, 0);
  return Math.hypot(dx, dy);
}

/** Does the point lie inside the entity's shape (with optional padding)? */
export function containsPoint(e: Entity, x: number, y: number, pad = 0): boolean {
  const r = radiusOf(e) + pad;
  if (isSquare(e)) return Math.abs(x - e.x) <= r && Math.abs(y - e.y) <= r;
  return dist(x, y, e.x, e.y) <= r;
}

export const squaresOverlap = (
  ax: number,
  ay: number,
  ah: number,
  bx: number,
  by: number,
  bh: number,
  margin = 0,
): boolean => Math.abs(ax - bx) < ah + bh + margin && Math.abs(ay - by) < ah + bh + margin;
