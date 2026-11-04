import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { createSandbox } from '../src/sim/scenario';
import { DEFS } from '../src/sim/defs';
import { ENEMY, NEUTRAL, PLAYER, type Entity } from '../src/sim/types';
import { starterProgram } from '../src/automation/presets';
import { describeRule, emptyProgram, nodeCount, sanitizeProgram } from '../src/automation/blocks';
import type { Program, Rule } from '../src/automation/types';

let n = 0;
const rule = (r: Partial<Rule> & Pick<Rule, 'act'>): Rule => ({ id: `t${n++}`, on: true, max: null, conds: [], ...r });

function base(program: Partial<Program> = {}) {
  const world = new World({ width: 50, height: 36 });
  const home = world.spawn('home', PLAYER, 12, 18);
  for (const y of [14, 16, 18, 20, 22]) world.spawn('mineralSource', NEUTRAL, 5, y);
  world.spawn('gasSource', NEUTRAL, 12, 11);
  const gs = [0, 1, 2, 3, 4, 5].map((i) => world.spawn('gatherer', PLAYER, 9, 15 + i));
  world.program = { ...emptyProgram(), ...program };
  return { world, home, gs };
}

const of = (w: World, def: Entity['def']) => w.list((e) => e.def === def);

describe('automation: unit rules', () => {
  it('no program rules: nothing happens (the puzzle start)', () => {
    const { world, home, gs } = base();
    world.stepSeconds(30);
    expect(home.stock.minerals).toBe(0);
    expect(gs.every((g) => g.order.type === 'idle')).toBe(true);
  });

  it('"always: gather minerals → Home" runs the economy', () => {
    const { world, home, gs } = base({ rules: { gatherer: [rule({ act: { kind: 'gather', res: 'minerals', to: 'home' } })] } });
    world.stepSeconds(30);
    expect(home.stock.minerals).toBeGreaterThan(300);
    expect(new Set(gs.map((g) => g.sourceId)).size).toBeGreaterThanOrEqual(5); // spread over the fields
  });

  it('a rule cap (max 2) limits how many units follow it; the rest fall through', () => {
    const { world, gs } = base({
      rules: {
        gatherer: [
          rule({ id: 'gas', max: 2, act: { kind: 'gather', res: 'gas', to: 'home' } }),
          rule({ id: 'min', act: { kind: 'gather', res: 'minerals', to: 'home' } }),
        ],
      },
    });
    world.stepSeconds(5);
    expect(gs.filter((g) => g.intent === 'gatherer#gas').length).toBe(2);
    expect(gs.filter((g) => g.intent === 'gatherer#min').length).toBe(4);
  });

  it('a higher rule interrupts a lower one as soon as its conditions hold', () => {
    const { world, home, gs } = base({
      rules: {
        gatherer: [
          rule({ id: 'gas', conds: [{ kind: 'stock', at: 'home', res: 'minerals', op: '>=', n: 100 }], act: { kind: 'gather', res: 'gas', to: 'home' } }),
          rule({ id: 'min', act: { kind: 'gather', res: 'minerals', to: 'home' } }),
        ],
      },
    });
    world.stepSeconds(2);
    expect(gs.every((g) => g.intent === 'gatherer#min')).toBe(true);
    world.stepSeconds(25);
    expect(home.stock.minerals).toBeGreaterThanOrEqual(100);
    expect(gs.every((g) => g.intent === 'gatherer#gas')).toBe(true);
    world.stepSeconds(20);
    expect(home.stock.gas).toBeGreaterThan(0);
  });

  it('player orders win until the unit finishes them', () => {
    const { world, gs } = base({ rules: { gatherer: [rule({ act: { kind: 'gather', res: 'minerals', to: 'home' } })] } });
    world.issue({ type: 'move', ids: [gs[0].id], x: 40, y: 30 });
    world.stepSeconds(3);
    expect(gs[0].order.type).toBe('move');
    expect(gs[0].manual).toBe(true);
    world.stepSeconds(15);
    expect(gs[0].manual).toBe(false);
    expect(gs[0].order.type).toBe('gather');
  });

  it('haul moves crates out of Home to a blueprint, which completes', () => {
    const { world, home } = base({
      rules: { gatherer: [rule({ conds: [{ kind: 'needs', res: 'minerals', where: 'any', not: false }], act: { kind: 'haul', res: 'minerals', from: 'home', to: 'needy' } })] },
    });
    home.stock.minerals = 400;
    const site = world.spawn('infantryTraining', PLAYER, 20, 18, { complete: false, stock: { minerals: -150, gas: 0 }, required: 150 });
    world.stepSeconds(20);
    expect(site.complete).toBe(true);
    // Haulers keep going until the new building has its reserve (2 × 100 minerals).
    world.stepSeconds(20);
    expect(site.stock.minerals).toBeGreaterThanOrEqual(200);
    expect(site.stock.minerals).toBeLessThan(200 + 6 * 50);
    expect(home.stock.minerals).toBe(400 - 150 - site.stock.minerals);
  });

  it('fighters run their own rules then the army rules; "attack nearest enemy" clears dummies', () => {
    const { world } = base({
      rules: {
        army: [
          rule({ conds: [{ kind: 'enemyNear', r: 12, not: false }], act: { kind: 'attack' } }),
          rule({ act: { kind: 'attackMove', to: 'enemy' } }),
        ],
      },
    });
    for (let i = 0; i < 4; i++) world.spawn('lightInfantry', PLAYER, 15, 16 + i);
    world.spawn('dummy', ENEMY, 40, 10);
    world.spawn('dummy', ENEMY, 42, 28);
    world.stepSeconds(60);
    expect(world.list((e) => e.team === ENEMY).length).toBe(0);
  });

  it('move-to-muster groups settle instead of re-issuing forever', () => {
    const { world } = base({ rules: { army: [rule({ act: { kind: 'move', to: 'muster' } })] } });
    const inf = [0, 1, 2, 3, 4].map((i) => world.spawn('lightInfantry', PLAYER, 14, 14 + i));
    world.stepSeconds(15);
    const before = inf.map((u) => [u.x, u.y]);
    world.stepSeconds(5);
    inf.forEach((u, i) => expect(Math.hypot(u.x - before[i][0], u.y - before[i][1])).toBeLessThan(0.3));
  });
});

describe('automation: buildings, base rules, build order', () => {
  it('buildings train through their rules and fall through when they cannot afford one', () => {
    const { world } = base({
      rules: {
        infantryTraining: [
          rule({ act: { kind: 'train', def: 'heavyInfantry' } }),
          rule({ act: { kind: 'train', def: 'lightInfantry' } }),
        ],
      },
    });
    world.spawn('infantryTraining', PLAYER, 20, 12, { stock: { minerals: 100, gas: 0 } });
    world.stepSeconds(DEFS.lightInfantry.buildTime! * 2 + 1);
    expect(of(world, 'heavyInfantry').length).toBe(0);
    expect(of(world, 'lightInfantry').length).toBe(2);
  });

  it('the build order places blueprints at layout slots and advances step by step', () => {
    const { world, home } = base({
      order: [
        { id: 'a', kind: 'build', def: 'infantryTraining' },
        { id: 'b', kind: 'build', def: 'mechFactory' },
      ],
      rules: { gatherer: [rule({ act: { kind: 'gather', res: 'minerals', to: 'needy' } })] },
    });
    world.stepSeconds(5);
    const it_ = of(world, 'infantryTraining')[0];
    expect(it_).toBeDefined();
    const slot = world.program!.layout.slots.find((s) => s.def === 'infantryTraining')!;
    expect(Math.abs(it_.x - (home.x + slot.dx))).toBeLessThan(0.6);
    expect(world.auto.step).toBe(1);
    expect(world.auto.stepStatus).toContain('Infantry Training'); // mech factory waits on its tech
    world.stepSeconds(90);
    expect(world.auto.step).toBe(2);
    expect(of(world, 'mechFactory').length).toBe(1);
  });

  it('base rules flip the posture', () => {
    const { world } = base({
      rules: { base: [rule({ conds: [{ kind: 'count', what: 'army', op: '>=', n: 3 }], act: { kind: 'setPosture', to: 'offense' } })] },
    });
    world.stepSeconds(1);
    expect(world.auto.posture).toBe('economy');
    for (let i = 0; i < 3; i++) world.spawn('tank', PLAYER, 20, 10 + i * 2);
    world.stepSeconds(1);
    expect(world.auto.posture).toBe('offense');
  });

  it('standing build rules place one blueprint of a type at a time', () => {
    const { world } = base({ rules: { base: [rule({ act: { kind: 'build', def: 'infantryTraining' } })] } });
    world.stepSeconds(10);
    expect(of(world, 'infantryTraining').length).toBe(1);
  });
});

describe('automation: the starter program', () => {
  it('clears the sandbox with no player input, and every unit family appears', () => {
    const w = createSandbox();
    w.program = starterProgram();
    let won = -1;
    for (let t = 0; t < 20 * 60 * 6; t++) {
      w.step();
      if (w.list((e) => e.team === ENEMY).length === 0) {
        won = w.seconds;
        break;
      }
    }
    expect(won).toBeGreaterThan(0);
    expect(won).toBeLessThan(300);
    for (const d of ['lightInfantry', 'heavyInfantry', 'tank', 'ship'] as const) expect(of(w, d).length).toBeGreaterThan(0);
    expect(w.commandLog.length).toBe(0); // no player commands at all
  });

  it('is deterministic', () => {
    const run = () => {
      const w = createSandbox();
      w.program = starterProgram();
      w.stepSeconds(100);
      return w.hash();
    };
    expect(run()).toBe(run());
  });
});

describe('program data', () => {
  it('sanitize keeps a valid program intact and drops junk', () => {
    const p = starterProgram();
    expect(sanitizeProgram(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const junk = sanitizeProgram({
      rules: {
        gatherer: [{ act: { kind: 'train', def: 'tank' } }, { act: { kind: 'gather', res: 'plutonium', to: 'home' }, conds: [{ kind: 'nope' }] }],
        bogus: [{ act: { kind: 'hold' } }],
      },
      order: [{ kind: 'wait', cond: { kind: 'count', what: 'gatherer', op: '>=', n: 1e9 } }],
    });
    expect(junk.rules.gatherer?.length).toBe(1);
    expect(junk.rules.gatherer?.[0].act).toEqual({ kind: 'gather', res: 'minerals', to: 'home' });
    expect(junk.rules.gatherer?.[0].conds).toEqual([]);
    expect((junk.order[0] as { cond: { n: number } }).cond.n).toBe(200);
  });

  it('rules read as sentences', () => {
    const p = starterProgram();
    expect(describeRule(p.rules.gatherer![0], 'gatherer')).toBe(
      'if something needs minerals at any building and stock at Home minerals ≥ 50 → haul minerals from Home to whatever needs it',
    );
    expect(describeRule(p.rules.gatherer![3], 'gatherer')).toBe('always → gather minerals → Home');
    expect(nodeCount(p)).toBeGreaterThan(20);
  });
});

describe('production view: keep targets are ordinary rules', () => {
  it('reads keep targets out of the starter program', async () => {
    const { getKeep } = await import('../src/automation/production');
    const p = starterProgram();
    expect(getKeep(p, 'gatherer')).toBe(16); // Home: if count of Gatherer < 16 → train Gatherer
    expect(getKeep(p, 'lightInfantry')).toBe(6);
    expect(getKeep(p, 'heavyInfantry')).toBe('always');
    expect(getKeep(p, 'tank')).toBe('always');
    expect(getKeep(p, 'infantryTraining')).toBe(null); // built by the build order instead
  });

  it('setting a keep edits, adds or removes exactly one rule, which then runs', async () => {
    const { getKeep, setKeep, findKeep } = await import('../src/automation/production');
    const p = emptyProgram();
    setKeep(p, 'gatherer', 7);
    expect(p.rules.home).toEqual([
      expect.objectContaining({ conds: [{ kind: 'count', what: 'gatherer', op: '<', n: 7 }], act: { kind: 'train', def: 'gatherer' } }),
    ]);
    const id = findKeep(p, 'gatherer')!.rule.id;
    setKeep(p, 'gatherer', 'always');
    expect(p.rules.home!.length).toBe(1);
    expect(p.rules.home![0].id).toBe(id); // same rule, edited in place
    expect(p.rules.home![0].conds).toEqual([]);
    setKeep(p, 'gatherer', 9);
    expect(getKeep(p, 'gatherer')).toBe(9);
    setKeep(p, 'infantryTraining', 2);
    expect(p.rules.base?.[0].act).toEqual({ kind: 'build', def: 'infantryTraining' });
    setKeep(p, 'gatherer', null);
    expect(p.rules.home).toBeUndefined();
    // Editing the rule elsewhere (e.g. its building tab) shows up as the keep value.
    p.rules.base![0].conds = [{ kind: 'count', what: 'infantryTraining', op: '<', n: 3 }];
    expect(getKeep(p, 'infantryTraining')).toBe(3);
    p.rules.base![0].on = false;
    expect(getKeep(p, 'infantryTraining')).toBe(null);
  });

  it('a keep target for a building places blueprints until there are that many', async () => {
    const { setKeep } = await import('../src/automation/production');
    const { world } = base({ rules: { gatherer: [rule({ act: { kind: 'gather', res: 'minerals', to: 'needy' } })] } });
    setKeep(world.program!, 'infantryTraining', 2);
    world.stepSeconds(240);
    expect(of(world, 'infantryTraining').length).toBe(2);
  });

  it('build-order steps continue from earlier ones', async () => {
    const { stepFor } = await import('../src/automation/production');
    const p = emptyProgram();
    const a = stepFor(p, 'gatherer');
    expect(a).toMatchObject({ kind: 'train', def: 'gatherer', n: 5 });
    p.order.push(a);
    expect(stepFor(p, 'gatherer')).toMatchObject({ n: 6 });
    expect(stepFor(p, 'tank')).toMatchObject({ kind: 'train', def: 'tank', n: 1 });
    expect(stepFor(p, 'port')).toMatchObject({ kind: 'build', def: 'port' });
  });
});
