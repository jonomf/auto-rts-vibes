import type { DefId } from './defs';
import { RULESETS, type Ruleset } from './ruleset';
import { ENEMY, NEUTRAL, PLAYER } from './types';
import { World } from './world';

export type ScenarioId = 'range' | 'outpost' | 'swarm' | 'armor' | 'air';

export type Scenario = {
  id: ScenarioId;
  name: string;
  blurb: string;
  /** What tends to work (shown in the New match dialog). */
  hint: string;
};

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  range: {
    id: 'range',
    name: 'Target range',
    blurb: 'Inert dummies and a bunker that never shoot back.',
    hint: 'Anything works. A place to test an economy.',
  },
  outpost: {
    id: 'outpost',
    name: 'Outpost',
    blurb: 'Bunkers, a Missile Turret, a sieged tank and a bio squad around a Command Center.',
    hint: 'A mixed army. Out-range the bunkers, or bring enough to trade.',
  },
  swarm: {
    id: 'swarm',
    name: 'Swarm',
    blurb: 'Packs of Zerglings with Banelings: fast, light, many, and Banelings burst light units.',
    hint: 'Splash and range: Hellions and sieged tanks. Massed Marines melt to Banelings; air is untouchable.',
  },
  armor: {
    id: 'armor',
    name: 'Armor line',
    blurb: 'Sieged tanks and Marauders dug in behind bunkers.',
    hint: 'Bonus vs armored (Marauders, tanks), or air: nothing here shoots up except the bunkers.',
  },
  air: {
    id: 'air',
    name: 'Air wing',
    blurb: 'Banshees and Vikings over Missile Turrets.',
    hint: 'Anti-air: Marines and Vikings. Tanks and Hellions can’t shoot up.',
  },
};

/** The player's starting base (identical in every scenario). */
function playerBase(world: World): void {
  const cc = world.spawn('commandCenter', PLAYER, 11, 22);
  cc.stock.minerals = 50;

  for (const [x, y] of [
    [4.6, 15.6],
    [3.9, 17.8],
    [3.5, 20.0],
    [3.4, 22.2],
    [3.5, 24.4],
    [3.9, 26.6],
    [4.6, 28.8],
  ])
    world.spawn('mineralSource', NEUTRAL, x, y);
  world.spawn('gasSource', NEUTRAL, 11, 14.5);
  world.spawn('gasSource', NEUTRAL, 11, 29.5);

  for (let i = 0; i < 4; i++) world.spawn('scv', PLAYER, 8, 19.8 + i * 1.5);

  // Expansion site (bottom middle).
  for (const [x, y] of [
    [27, 40.5],
    [29.2, 41],
    [31.4, 41],
    [33.6, 40.5],
  ])
    world.spawn('mineralSource', NEUTRAL, x, y);
  world.spawn('gasSource', NEUTRAL, 37.5, 38.5);
}

/** An enemy defender that holds its post (returns if it chases too far). */
function defend(world: World, def: DefId, x: number, y: number, extra: { sieged?: boolean } = {}): void {
  world.spawn(def, ENEMY, x, y, { leash: { x, y }, sieged: extra.sieged ?? false });
}

function pack(world: World, def: DefId, cx: number, cy: number, n: number, spacing = 1): void {
  const cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++)
    defend(world, def, cx + ((i % cols) - (cols - 1) / 2) * spacing, cy + (Math.floor(i / cols) - (cols - 1) / 2) * spacing);
}

const GARRISONS: Record<ScenarioId, (w: World) => void> = {
  range: (w) => {
    w.spawn('dummyBunker', ENEMY, 56, 22);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 2; col++) w.spawn('dummy', ENEMY, 50 + col * 1.6, 17.5 + row * 3);
  },
  outpost: (w) => {
    w.spawn('commandCenter', ENEMY, 57, 22);
    w.spawn('bunker', ENEMY, 48, 18);
    w.spawn('bunker', ENEMY, 48, 26);
    w.spawn('missileTurret', ENEMY, 53, 15);
    w.spawn('missileTurret', ENEMY, 53, 29);
    defend(w, 'siegeTank', 54, 22, { sieged: true });
    pack(w, 'marine', 50.5, 22, 4, 1);
    defend(w, 'marauder', 51, 19);
    defend(w, 'marauder', 51, 25);
  },
  swarm: (w) => {
    w.spawn('dummyBunker', ENEMY, 57, 22);
    pack(w, 'zergling', 48, 13, 12, 0.8);
    pack(w, 'zergling', 48, 31, 12, 0.8);
    pack(w, 'zergling', 52, 22, 16, 0.8);
    pack(w, 'zergling', 43, 22, 9, 0.8);
    pack(w, 'baneling', 45, 17, 6, 0.9);
    pack(w, 'baneling', 45, 27, 6, 0.9);
  },
  armor: (w) => {
    w.spawn('bunker', ENEMY, 46, 17);
    w.spawn('bunker', ENEMY, 46, 27);
    defend(w, 'siegeTank', 52, 16, { sieged: true });
    defend(w, 'siegeTank', 52, 22, { sieged: true });
    defend(w, 'siegeTank', 52, 28, { sieged: true });
    pack(w, 'marauder', 49, 22, 4, 1.1);
    w.spawn('dummyBunker', ENEMY, 57, 22);
  },
  air: (w) => {
    w.spawn('missileTurret', ENEMY, 47, 15);
    w.spawn('missileTurret', ENEMY, 47, 29);
    w.spawn('missileTurret', ENEMY, 54, 22);
    pack(w, 'viking', 51, 18, 3, 1.3);
    pack(w, 'banshee', 51, 26, 3, 1.3);
    w.spawn('dummyBunker', ENEMY, 58, 22);
  },
};

export function createScenario(id: ScenarioId = 'range', ruleset: Ruleset = RULESETS.classic): World {
  const world = new World({ width: 64, height: 44 }, ruleset);
  playerBase(world);
  GARRISONS[id](world);
  return world;
}

/** The original M1 sandbox (target range, classic rules). */
export const createSandbox = (ruleset?: Ruleset) => createScenario('range', ruleset);
