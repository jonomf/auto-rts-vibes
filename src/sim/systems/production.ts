import { DEFS, isAddon, type AddonId } from '../defs';
import { addonSpot, applyRally, isBuilding } from '../actions';
import { SOFT_CAP_SLOWDOWN } from '../ruleset';
import { PLAYER, type Entity, type Team } from '../types';
import type { World } from '../world';

/** How many queue items a building works on at once (a Reactor doubles it). */
export const lanesOf = (b: Entity) => (b.addon === 'reactor' ? 2 : 1);

/**
 * Advance training queues. Finished units spawn at the building's edge; finished add-ons
 * attach to the building (and, under classic rules, appear beside it).
 */
export function productionSystem(world: World, dt: number): void {
  const overCap = new Map<Team, boolean>();
  const isOver = (team: Team) => {
    if (!overCap.has(team)) {
      const s = world.supply(team);
      overCap.set(team, s.used > s.cap);
    }
    return overCap.get(team)!;
  };

  for (const b of world.list((e) => e.queue.length > 0 && e.complete)) {
    const lanes = Math.min(lanesOf(b), b.queue.length);
    for (let i = 0; i < lanes; i++) {
      const item = b.queue[i];
      // Soft supply cap: everything trains slower while you're over it.
      const slow = world.ruleset.supply === 'soft' && !isAddon(item.def) && isOver(b.team) ? SOFT_CAP_SLOWDOWN : 1;
      item.elapsed += dt / slow;
    }
    for (let i = lanes - 1; i >= 0; i--) {
      const item = b.queue[i];
      if (item.elapsed + 1e-9 < (DEFS[item.def].buildTime ?? 1)) continue;
      b.queue.splice(i, 1);
      if (isAddon(item.def)) attachAddon(world, b, item.def);
      else applyRally(world, spawnBeside(world, b, item.def), b);
    }
  }

  // Strategy-lab statistic: time a production building sat idle because the (hard) cap was reached.
  if (world.ruleset.supply === 'hard') {
    const s = world.supply(PLAYER);
    if (s.used >= s.cap && s.cap < 200) {
      const idle = world.list((e) => e.team === PLAYER && isBuilding(e) && e.complete && !!DEFS[e.def].trains && e.queue.length === 0);
      if (idle.length) world.stats.supplyBlocked += dt;
    }
  }
}

function attachAddon(world: World, b: Entity, def: AddonId): void {
  b.addon = def;
  if (world.ruleset.addons !== 'attached') return;
  const spot = addonSpot(b);
  const a = world.spawn(def, b.team, spot.x, spot.y, { linkId: b.id });
  b.linkId = a.id;
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
