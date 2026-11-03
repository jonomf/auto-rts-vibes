import { DEFS } from '../defs';
import { isFlying, isGatherer, isUnit } from '../actions';
import type { Entity } from '../types';
import type { World } from '../world';

const STRENGTH = 0.5;

/**
 * Keep units from stacking. Gatherers ghost through everything (like Starcraft mineral
 * walking) so they never jam the mining line; flyers only push other flyers.
 * There is no building collision yet -- movement is straight-line with no pathfinding.
 */
export function separationSystem(world: World): void {
  const ground: Entity[] = [];
  const air: Entity[] = [];
  for (const e of world.all()) {
    if (!isUnit(e) || isGatherer(e)) continue;
    (isFlying(e) ? air : ground).push(e);
  }
  separate(ground);
  separate(air);
  clampToMap(world, ground);
  clampToMap(world, air);
}

function separate(group: Entity[]): void {
  for (let i = 0; i < group.length; i++) {
    const a = group[i];
    const ra = DEFS[a.def].radius;
    for (let j = i + 1; j < group.length; j++) {
      const b = group[j];
      const min = ra + DEFS[b.def].radius;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
      let d = Math.hypot(dx, dy);
      if (d >= min) continue;
      if (d < 1e-6) {
        // Exactly stacked: pick a stable direction from the ids.
        const angle = ((a.id * 7 + b.id * 13) % 360) * (Math.PI / 180);
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        d = 1;
      }
      const push = (min - d) * STRENGTH;
      const nx = dx / d;
      const ny = dy / d;
      const aFixed = DEFS[a.def].inert === true;
      const bFixed = DEFS[b.def].inert === true;
      if (aFixed && bFixed) continue;
      const shareA = aFixed ? 0 : bFixed ? 1 : 0.5;
      const shareB = 1 - shareA;
      a.x -= nx * push * shareA;
      a.y -= ny * push * shareA;
      b.x += nx * push * shareB;
      b.y += ny * push * shareB;
    }
  }
}

function clampToMap(world: World, group: Entity[]): void {
  const { width, height } = world.map;
  for (const e of group) {
    const r = DEFS[e.def].radius;
    e.x = Math.min(width - r, Math.max(r, e.x));
    e.y = Math.min(height - r, Math.max(r, e.y));
  }
}
