/**
 * The command card: which buttons the current selection offers.
 * Mirrors the Unity GameAction ScriptableObjects (MoveAction, ShowMenu, CreateBuilding, CreateUnit).
 */
import { DEFS, costOf, formatCost, type DefId } from '../sim/defs';
import { canAttack, checkTrain, isBuilding, isGatherer, isUnit, missingRequirement } from '../sim/actions';
import { PLAYER, type Entity } from '../sim/types';
import type { Game } from '../game';

export type UiAction = {
  id: string;
  label: string;
  hotkey: string;
  /** Cost line shown under the label. */
  detail?: string;
  /** If set, the button is disabled and this explains why. */
  disabled?: string;
  tooltip?: string;
  active?: boolean;
  icon: DefId | 'move' | 'stop' | 'attack' | 'build' | 'back';
  run: () => void;
};

const TRAIN_KEYS = ['Q', 'W', 'E', 'R'];
const BUILD_KEYS = ['Q', 'W', 'E', 'R'];

export const ownControllable = (e: Entity) => e.team === PLAYER && !DEFS[e.def].inert;

export function computeActions(game: Game): UiAction[] {
  const sel = game.selected().filter(ownControllable);
  const units = sel.filter(isUnit);
  const buildings = sel.filter(isBuilding);

  if (units.length > 0) {
    const gatherers = units.filter(isGatherer);
    if (game.menu === 'build' && gatherers.length > 0) return buildMenu(game, gatherers[0]);
    return unitCommands(game, units, gatherers);
  }

  if (buildings.length > 0) {
    // Command card for the first building type in the selection (Starcraft-style subgroup).
    // Blueprints can't act until delivered (Unity: Building.CanAct).
    const type = buildings[0].def;
    const same = buildings.filter((b) => b.def === type && b.complete);
    return same.length ? trainCommands(game, same) : [];
  }

  return [];
}

function unitCommands(game: Game, units: Entity[], gatherers: Entity[]): UiAction[] {
  const ids = units.map((u) => u.id);
  const out: UiAction[] = [
    {
      id: 'move',
      label: 'Move',
      hotkey: 'M',
      icon: 'move',
      active: game.mode.type === 'move',
      run: () => {
        game.mode = { type: 'move' };
        game.uiVersion++;
      },
    },
    {
      id: 'stop',
      label: 'Stop',
      hotkey: 'S',
      icon: 'stop',
      run: () => game.issue({ type: 'stop', ids }),
    },
  ];
  if (units.some(canAttack))
    out.push({
      id: 'attack',
      label: 'Attack',
      hotkey: 'A',
      icon: 'attack',
      active: game.mode.type === 'attack',
      run: () => {
        game.mode = { type: 'attack' };
        game.uiVersion++;
      },
    });
  if (gatherers.length > 0)
    out.push({
      id: 'build',
      label: 'Build',
      hotkey: 'B',
      icon: 'build',
      run: () => {
        game.menu = 'build';
        game.uiVersion++;
      },
    });
  return out;
}

function buildMenu(game: Game, builder: Entity): UiAction[] {
  const builds = DEFS[builder.def].builds ?? [];
  const out: UiAction[] = builds.map((def, i) => {
    const req = missingRequirement(game.world, builder.team, def);
    return {
      id: `build:${def}`,
      label: DEFS[def].name,
      hotkey: BUILD_KEYS[i] ?? '',
      detail: formatCost(costOf(def)),
      disabled: req ? `Requires ${DEFS[req].name}` : undefined,
      active: game.mode.type === 'place' && game.mode.def === def,
      icon: def,
      run: () => {
        game.mode = { type: 'place', def, builderId: builder.id };
        game.uiVersion++;
      },
    };
  });
  out.push({
    id: 'back',
    label: 'Back',
    hotkey: 'Esc',
    icon: 'back',
    run: () => {
      game.menu = 'root';
      if (game.mode.type === 'place') game.mode = { type: 'normal' };
      game.uiVersion++;
    },
  });
  return out;
}

function trainCommands(game: Game, buildings: Entity[]): UiAction[] {
  const trains = DEFS[buildings[0].def].trains ?? [];
  return trains.map((def, i) => {
    // Prefer the building that can afford it with the shortest queue.
    const ready = buildings
      .filter((b) => checkTrain(game.world, b, def).ok)
      .sort((a, b) => a.queue.length - b.queue.length || a.id - b.id)[0];
    const reason = ready ? undefined : (checkTrain(game.world, buildings[0], def) as { reason: string }).reason;
    const d = DEFS[def];
    return {
      id: `train:${def}`,
      label: d.name,
      hotkey: TRAIN_KEYS[i] ?? '',
      detail: formatCost(costOf(def)),
      disabled: reason,
      tooltip: `${d.name} · ${formatCost(costOf(def))} · ${d.buildTime}s`,
      icon: def,
      run: () => {
        const b = ready ?? buildings[0];
        game.issue({ type: 'train', buildingId: b.id, def });
      },
    };
  });
}
