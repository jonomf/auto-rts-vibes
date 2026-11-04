import { DEFS } from '../defs';
import { canHit, dealDamage, isBuilding } from '../actions';
import type { World } from '../world';

/** Static defenses (Bunker, Missile Turret): shoot the nearest enemy in range. */
export function defenseSystem(world: World, dt: number): void {
  for (const b of world.list((e) => isBuilding(e) && !!DEFS[e.def].attack && e.complete && !DEFS[e.def].inert)) {
    if (b.cooldown > 0) b.cooldown = Math.max(0, b.cooldown - dt);
    if (b.cooldown > 0) continue;
    const atk = DEFS[b.def].attack!;
    const target = world.nearest(b, (e) => canHit(b, e), atk.range);
    if (!target) continue;
    dealDamage(world, b, target);
    b.cooldown = atk.cooldown;
  }
}
