/**
 * Commands are the only way to change what entities do. The player's mouse and
 * (in M2) automation programs both issue these same commands.
 */
import { DEFS, costOf } from './defs';
import { startDeploy } from './systems/units';
import { applyStim } from './systems/status';
import {
  checkAddon,
  canAttack,
  checkPlacement,
  checkTrain,
  isBuilding,
  isGatherer,
  isUnit,
  missingRequirement,
  targetEntity,
} from './actions';
import type { Command, CommandResult, CommandSource, Entity, EntityId } from './types';
import type { World } from './world';

const ok: CommandResult = { ok: true };
const fail = (reason: string): CommandResult => ({ ok: false, reason });

const controllable = (e: Entity | undefined): e is Entity =>
  !!e && !DEFS[e.def].inert && e.team !== -1;

function units(world: World, ids: EntityId[]): Entity[] {
  return ids.map((id) => world.get(id)).filter((e): e is Entity => controllable(e) && isUnit(e));
}

/**
 * Spread a group around a destination so units don't all fight over one point.
 * Returns offsets in the same order as `group` (sorted by id for determinism).
 */
export function formationOffsets(group: Entity[]): { x: number; y: number }[] {
  if (group.length <= 1) return group.map(() => ({ x: 0, y: 0 }));
  const spacing = 2 * Math.max(...group.map((e) => DEFS[e.def].radius)) + 0.3;
  const cols = Math.ceil(Math.sqrt(group.length));
  const rows = Math.ceil(group.length / cols);
  return group.map((_, i) => ({
    x: ((i % cols) - (cols - 1) / 2) * spacing,
    y: (Math.floor(i / cols) - (rows - 1) / 2) * spacing,
  }));
}

function moveGroup(world: World, ids: EntityId[], x: number, y: number, attack: boolean): CommandResult {
  const group = units(world, ids).sort((a, b) => a.id - b.id);
  if (group.length === 0) return fail('No units selected');
  const offsets = formationOffsets(group);
  const { width, height } = world.map;
  group.forEach((u, i) => {
    const tx = Math.min(width, Math.max(0, x + offsets[i].x));
    const ty = Math.min(height, Math.max(0, y + offsets[i].y));
    u.stuck = 0;
    u.order =
      attack && canAttack(u)
        ? { type: 'attackMove', x: tx, y: ty, engagedId: null }
        : { type: 'move', x: tx, y: ty };
  });
  return ok;
}

/**
 * When several gatherers are sent to one mineral field, spread them over the clicked
 * field and its neighbours (same type, nearest first) instead of stacking on one.
 */
function spreadFields(world: World, target: Entity, group: Entity[]): Entity[] {
  const res = DEFS[target.def].resource;
  if (!res || group.filter(isGatherer).length < 2) return [];
  return world
    .list((e) => DEFS[e.def].resource?.type === res.type && e.remaining > 0 && Math.hypot(e.x - target.x, e.y - target.y) <= 5)
    .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y) || a.id - b.id);
}

export function applyCommand(world: World, cmd: Command, source: CommandSource = 'player'): CommandResult {
  const result = apply(world, cmd);
  // Player orders take priority over automation until the unit finishes them.
  if (result.ok && source === 'player' && 'ids' in cmd)
    for (const u of units(world, cmd.ids)) {
      u.manual = cmd.type !== 'stop';
      u.intent = null;
    }
  if (result.ok && source === 'player' && cmd.type === 'build') {
    const b = world.get(cmd.builderId);
    if (b) {
      b.manual = true;
      b.intent = null;
    }
  }
  return result;
}

function apply(world: World, cmd: Command): CommandResult {
  switch (cmd.type) {
    case 'move':
      return moveGroup(world, cmd.ids, cmd.x, cmd.y, false);

    case 'attackMove':
      return moveGroup(world, cmd.ids, cmd.x, cmd.y, true);

    case 'target': {
      const target = world.get(cmd.targetId);
      if (!target) return fail('Target is gone');
      const group = units(world, cmd.ids);
      if (group.length === 0) return fail('No units selected');
      const fields = spreadFields(world, target, group);
      group.forEach((u, i) => {
        u.stuck = 0;
        const t = isGatherer(u) && fields.length > 0 ? fields[i % fields.length] : target;
        targetEntity(world, u, t);
      });
      return ok;
    }

    case 'stop': {
      for (const u of units(world, cmd.ids)) u.order = { type: 'idle' };
      return ok;
    }

    case 'siege': {
      const tanks = units(world, cmd.ids).filter((u) => DEFS[u.def].siege);
      if (tanks.length === 0) return fail('Only Siege Tanks can siege');
      for (const u of tanks) {
        if (cmd.on && !u.sieged) u.order = { type: 'idle' };
        startDeploy(u, cmd.on);
      }
      return ok;
    }

    case 'stim': {
      const bio = units(world, cmd.ids).filter((u) => DEFS[u.def].stim);
      if (bio.length === 0) return fail('Only Marines and Marauders can stim');
      const n = bio.filter((u) => applyStim(world, u)).length;
      return n > 0 ? ok : fail('Already stimmed, or too hurt to stim');
    }

    case 'addon': {
      const b = world.get(cmd.buildingId);
      if (!controllable(b) || !isBuilding(b)) return fail('No building selected');
      const check = checkAddon(world, b, cmd.def);
      if (!check.ok) return check;
      const c = costOf(cmd.def);
      b.stock.minerals -= c.minerals;
      b.stock.gas -= c.gas;
      b.queue.push({ def: cmd.def, elapsed: 0 });
      return ok;
    }

    case 'haul': {
      const from = world.get(cmd.fromId);
      const to = world.get(cmd.toId);
      if (!from || !to || !isBuilding(from) || !isBuilding(to)) return fail('Haul needs two buildings');
      if (from.id === to.id) return fail('Pick two different buildings');
      if (!from.complete) return fail(`${DEFS[from.def].name} is still a blueprint`);
      const haulers = units(world, cmd.ids).filter(isGatherer);
      if (haulers.length === 0) return fail('Only gatherers can haul');
      for (const u of haulers) {
        u.stuck = 0;
        u.order = {
          type: 'haul',
          res: cmd.res,
          fromId: from.id,
          toId: to.id,
          phase: u.cargo ? 'toTo' : 'toFrom',
        };
      }
      return ok;
    }

    case 'build': {
      const builder = world.get(cmd.builderId);
      if (!controllable(builder) || !isUnit(builder)) return fail('No builder selected');
      if (!DEFS[builder.def].builds?.includes(cmd.def))
        return fail(`${DEFS[builder.def].name} can't build ${DEFS[cmd.def].name}`);
      const req = missingRequirement(world, builder.team, cmd.def);
      if (req) return fail(`Requires ${DEFS[req].name}`);
      const placement = checkPlacement(world, cmd.def, cmd.x, cmd.y);
      if (!placement.ok) return placement;
      builder.stuck = 0;
      builder.order = { type: 'build', def: cmd.def, x: cmd.x, y: cmd.y };
      return ok;
    }

    case 'train': {
      const b = world.get(cmd.buildingId);
      if (!controllable(b) || !isBuilding(b)) return fail('No building selected');
      const check = checkTrain(world, b, cmd.def);
      if (!check.ok) return check;
      const c = costOf(cmd.def);
      b.stock.minerals -= c.minerals;
      b.stock.gas -= c.gas;
      b.queue.push({ def: cmd.def, elapsed: 0 });
      return ok;
    }

    case 'cancelTrain': {
      const b = world.get(cmd.buildingId);
      if (!b || !isBuilding(b)) return fail('No building selected');
      const item = b.queue[cmd.index];
      if (!item) return fail('Nothing to cancel');
      b.queue.splice(cmd.index, 1);
      const c = costOf(item.def);
      b.stock.minerals += c.minerals;
      b.stock.gas += c.gas;
      return ok;
    }

    case 'rally': {
      const target = world.get(cmd.targetId);
      let n = 0;
      for (const id of cmd.buildingIds) {
        const b = world.get(id);
        if (!controllable(b) || !isBuilding(b)) continue;
        b.rally = target && target.id !== b.id
          ? { kind: 'entity', id: target.id }
          : { kind: 'point', x: cmd.x, y: cmd.y };
        n++;
      }
      return n > 0 ? ok : fail('No building selected');
    }
  }
}
