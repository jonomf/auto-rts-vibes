import { DEFS } from '../defs';
import { applyRally } from '../actions';
import type { Entity } from '../types';
import type { World } from '../world';

/** Advance each building's training queue; spawn finished units at the building's edge. */
export function productionSystem(world: World, dt: number): void {
  for (const b of world.list((e) => e.queue.length > 0 && e.complete)) {
    const item = b.queue[0];
    item.elapsed += dt;
    const buildTime = DEFS[item.def].buildTime ?? 1;
    if (item.elapsed + 1e-9 < buildTime) continue;
    b.queue.shift();
    const unit = spawnBeside(world, b, item.def);
    applyRally(world, unit, b);
  }
}

function spawnBeside(world: World, b: Entity, def: Entity['def']): Entity {
  // Exit toward the rally point, or out the "front" (+y, toward the bottom of the screen).
  let dx = 0;
  let dy = 1;
  const rally = b.rally;
  const rallyPos =
    rally?.kind === 'point' ? rally : rally?.kind === 'entity' ? world.get(rally.id) : undefined;
  if (rallyPos) {
    const len = Math.hypot(rallyPos.x - b.x, rallyPos.y - b.y);
    if (len > 0.01) {
      dx = (rallyPos.x - b.x) / len;
      dy = (rallyPos.y - b.y) / len;
    }
  }
  // Push the spawn point out to the square's edge along that direction.
  const half = DEFS[b.def].radius;
  const r = DEFS[def].radius;
  const scale = half / Math.max(Math.abs(dx), Math.abs(dy));
  const x = b.x + dx * (scale + r + 0.3);
  const y = b.y + dy * (scale + r + 0.3);
  const unit = world.spawn(def, b.team, x, y);
  unit.facing = Math.atan2(dy, dx);
  return unit;
}
