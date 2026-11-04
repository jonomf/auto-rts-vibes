import { DEFAULT_LAYOUT } from './blocks';
import type { Action, Condition, Program, Rule, Step } from './types';

/**
 * Example programs. Each one plays a whole match with no input. They double as the
 * strategy lab's contestants (tests/lab) and as starting points in the editor.
 */

/** A step without its id (Omit over each member of the union). */
type StepIn = Step extends infer S ? (S extends Step ? Omit<S, 'id'> : never) : never;

let n = 0;
const rule = (conds: Condition[], act: Action, max: number | null = null): Rule => ({ id: `p${n++}`, on: true, max, conds, act });
const step = (s: StepIn): Step => ({ id: `s${n++}`, ...s }) as Step;
const always = (act: Action, max: number | null = null) => rule([], act, max);
const count = (what: Extract<Condition, { kind: 'count' }>['what'], op: '<' | '>=', k: number): Condition => ({ kind: 'count', what, op, n: k });

/** SCVs: income to the Command Center, crates out to whatever needs them, gas once there's a Refinery. */
function scvRules(gasWorkers: number, haulers = 3): Rule[] {
  return [
    rule(
      [
        { kind: 'needs', res: 'minerals', where: 'any', not: false },
        { kind: 'stock', at: 'commandCenter', res: 'minerals', op: '>=', n: 50 },
      ],
      { kind: 'haul', res: 'minerals', from: 'commandCenter', to: 'needy' },
      haulers,
    ),
    rule(
      [
        { kind: 'needs', res: 'gas', where: 'any', not: false },
        { kind: 'stock', at: 'commandCenter', res: 'gas', op: '>=', n: 25 },
      ],
      { kind: 'haul', res: 'gas', from: 'commandCenter', to: 'needy' },
      2,
    ),
    rule([{ kind: 'has', def: 'refinery', not: false }], { kind: 'gather', res: 'gas', to: 'commandCenter' }, gasWorkers),
    always({ kind: 'gather', res: 'minerals', to: 'commandCenter' }),
  ];
}

/** Fight what's close; attack when the posture says so; otherwise gather at the muster point. */
const ARMY: () => Rule[] = () => [
  rule([{ kind: 'enemyNear', r: 8, not: false }], { kind: 'attack' }),
  rule([{ kind: 'posture', is: 'offense' }], { kind: 'attackMove', to: 'enemy' }),
  always({ kind: 'move', to: 'muster' }),
];

/** Classic rules don't siege or stim by themselves: these rules do it. (Harmless under streamlined.) */
const SIEGE: () => Rule[] = () => [
  rule([{ kind: 'enemyNear', r: 13, not: false }, { kind: 'sieged', not: true }], { kind: 'siege' }),
  rule([{ kind: 'enemyNear', r: 15, not: true }, { kind: 'sieged', not: false }], { kind: 'unsiege' }),
];
const STIM: () => Rule[] = () => [rule([{ kind: 'enemyNear', r: 6, not: false }, { kind: 'hp', op: '>=', pct: 60 }], { kind: 'stim' })];

const SUPPLY_RULE = () => rule([{ kind: 'supply', op: '<', n: 5 }], { kind: 'build', def: 'supplyDepot' });
const ATTACK_AT = (army: number) => rule([count('army', '>=', army)], { kind: 'setPosture', to: 'offense' });

function program(order: StepIn[], rules: Program['rules']): Program {
  return { v: 1, order: order.map(step), rules, layout: DEFAULT_LAYOUT() };
}

/** A bit of everything: bio from a Tech Lab Barracks, tanks, and Vikings/Medivacs. */
export function starterProgram(): Program {
  return program(
    [
      { kind: 'wait', cond: count('scv', '>=', 7) },
      { kind: 'build', def: 'supplyDepot' },
      { kind: 'build', def: 'barracks' },
      { kind: 'build', def: 'refinery' },
      { kind: 'wait', cond: count('scv', '>=', 11) },
      { kind: 'addon', def: 'techLab', on: 'barracks' },
      { kind: 'build', def: 'factory' },
      { kind: 'build', def: 'refinery' },
      { kind: 'addon', def: 'techLab', on: 'factory' },
      { kind: 'build', def: 'starport' },
    ],
    {
      base: [SUPPLY_RULE(), ATTACK_AT(14)],
      scv: scvRules(6),
      army: ARMY(),
      siegeTank: SIEGE(),
      marine: STIM(),
      marauder: STIM(),
      commandCenter: [rule([count('scv', '<', 20)], { kind: 'train', def: 'scv' })],
      barracks: [
        rule([count('marauder', '<', 4)], { kind: 'train', def: 'marauder' }),
        rule([count('medic', '<', 2)], { kind: 'train', def: 'medic' }),
        always({ kind: 'train', def: 'marine' }),
      ],
      factory: [always({ kind: 'train', def: 'siegeTank' }), always({ kind: 'train', def: 'hellion' })],
      starport: [rule([count('medivac', '<', 1)], { kind: 'train', def: 'medivac' }), always({ kind: 'train', def: 'viking' })],
    },
  );
}

/** Bio: three Barracks (one Tech Lab, two Reactors), Marines + Marauders + Medics, stim. */
export function bioProgram(): Program {
  return program(
    [
      { kind: 'wait', cond: count('scv', '>=', 7) },
      { kind: 'build', def: 'supplyDepot' },
      { kind: 'build', def: 'barracks' },
      { kind: 'build', def: 'refinery' },
      { kind: 'build', def: 'barracks' },
      { kind: 'addon', def: 'techLab', on: 'barracks' },
      { kind: 'addon', def: 'reactor', on: 'barracks' },
      { kind: 'build', def: 'barracks' },
      { kind: 'addon', def: 'reactor', on: 'barracks' },
    ],
    {
      base: [SUPPLY_RULE(), ATTACK_AT(22)],
      scv: scvRules(3, 4),
      army: ARMY(),
      marine: STIM(),
      marauder: STIM(),
      commandCenter: [rule([count('scv', '<', 20)], { kind: 'train', def: 'scv' })],
      barracks: [
        rule([{ kind: 'addon', is: 'techLab' }, count('medic', '<', 4)], { kind: 'train', def: 'medic' }),
        rule([{ kind: 'addon', is: 'techLab' }], { kind: 'train', def: 'marauder' }),
        always({ kind: 'train', def: 'marine' }),
      ],
    },
  );
}

/** Mech: two Factories (Tech Lab for tanks, Reactor for Hellions), tanks siege on contact. */
export function mechProgram(): Program {
  return program(
    [
      { kind: 'wait', cond: count('scv', '>=', 7) },
      { kind: 'build', def: 'supplyDepot' },
      { kind: 'build', def: 'barracks' },
      { kind: 'build', def: 'refinery' },
      { kind: 'build', def: 'refinery' },
      { kind: 'build', def: 'factory' },
      { kind: 'addon', def: 'techLab', on: 'factory' },
      { kind: 'build', def: 'factory' },
      { kind: 'addon', def: 'reactor', on: 'factory' },
    ],
    {
      base: [SUPPLY_RULE(), ATTACK_AT(12)],
      scv: scvRules(6, 4),
      army: ARMY(),
      siegeTank: SIEGE(),
      commandCenter: [rule([count('scv', '<', 20)], { kind: 'train', def: 'scv' })],
      barracks: [rule([count('marine', '<', 4)], { kind: 'train', def: 'marine' })],
      factory: [always({ kind: 'train', def: 'siegeTank' }), always({ kind: 'train', def: 'hellion' })],
    },
  );
}

/** Air: two Starports (Tech Lab Banshees, Reactor Vikings) plus a Medivac. */
export function airProgram(): Program {
  return program(
    [
      { kind: 'wait', cond: count('scv', '>=', 7) },
      { kind: 'build', def: 'supplyDepot' },
      { kind: 'build', def: 'barracks' },
      { kind: 'build', def: 'refinery' },
      { kind: 'build', def: 'refinery' },
      { kind: 'build', def: 'factory' },
      { kind: 'build', def: 'starport' },
      { kind: 'addon', def: 'techLab', on: 'starport' },
      { kind: 'build', def: 'starport' },
      { kind: 'addon', def: 'reactor', on: 'starport' },
    ],
    {
      base: [SUPPLY_RULE(), ATTACK_AT(10)],
      scv: scvRules(6, 4),
      army: ARMY(),
      commandCenter: [rule([count('scv', '<', 20)], { kind: 'train', def: 'scv' })],
      barracks: [rule([count('marine', '<', 2)], { kind: 'train', def: 'marine' })],
      starport: [
        // Without the add-on conditions, a Tech Lab Starport short on gas falls through to Vikings.
        rule([{ kind: 'addon', is: 'techLab' }], { kind: 'train', def: 'banshee' }),
        rule([{ kind: 'addon', is: 'reactor' }, count('viking', '<', 8)], { kind: 'train', def: 'viking' }),
        rule([{ kind: 'addon', is: 'reactor' }], { kind: 'train', def: 'medivac' }),
      ],
    },
  );
}

export const PRESETS = {
  starter: { name: 'Starter', blurb: 'A bit of everything', make: starterProgram },
  bio: { name: 'Bio', blurb: 'Marines, Marauders, Medics, stim', make: bioProgram },
  mech: { name: 'Mech', blurb: 'Siege Tanks and Hellions', make: mechProgram },
  air: { name: 'Air', blurb: 'Banshees and Vikings', make: airProgram },
} as const;

export type PresetId = keyof typeof PRESETS;
