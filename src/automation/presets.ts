import { DEFAULT_LAYOUT } from './blocks';
import type { Program } from './types';

/**
 * A complete program that clears the sandbox with no input: all income goes to Home,
 * gatherers haul crates out to whatever needs them, production buildings train
 * continuously, and the army musters until it is big enough to attack.
 */
export function starterProgram(): Program {
  return {
    v: 1,
    order: [
      { id: 's1', kind: 'wait', cond: { kind: 'count', what: 'scv', op: '>=', n: 8 } },
      { id: 's2', kind: 'build', def: 'barracks' },
      { id: 's3', kind: 'wait', cond: { kind: 'count', what: 'scv', op: '>=', n: 12 } },
      { id: 's4', kind: 'build', def: 'factory' },
      { id: 's5', kind: 'build', def: 'starport' },
    ],
    rules: {
      base: [
        { id: 'b1', on: true, max: null, conds: [{ kind: 'count', what: 'army', op: '>=', n: 12 }], act: { kind: 'setPosture', to: 'offense' } },
      ],
      scv: [
        {
          id: 'g1',
          on: true,
          max: 3,
          conds: [
            { kind: 'needs', res: 'minerals', where: 'any', not: false },
            { kind: 'stock', at: 'commandCenter', res: 'minerals', op: '>=', n: 50 },
          ],
          act: { kind: 'haul', res: 'minerals', from: 'commandCenter', to: 'needy' },
        },
        {
          id: 'g2',
          on: true,
          max: 2,
          conds: [
            { kind: 'needs', res: 'gas', where: 'any', not: false },
            { kind: 'stock', at: 'commandCenter', res: 'gas', op: '>=', n: 25 },
          ],
          act: { kind: 'haul', res: 'gas', from: 'commandCenter', to: 'needy' },
        },
        {
          id: 'g3',
          on: true,
          max: 5,
          conds: [{ kind: 'has', def: 'barracks', not: false }],
          act: { kind: 'gather', res: 'gas', to: 'commandCenter' },
        },
        { id: 'g4', on: true, max: null, conds: [], act: { kind: 'gather', res: 'minerals', to: 'commandCenter' } },
      ],
      army: [
        { id: 'a1', on: true, max: null, conds: [{ kind: 'enemyNear', r: 8, not: false }], act: { kind: 'attack' } },
        { id: 'a2', on: true, max: null, conds: [{ kind: 'posture', is: 'offense' }], act: { kind: 'attackMove', to: 'enemy' } },
        { id: 'a3', on: true, max: null, conds: [], act: { kind: 'move', to: 'muster' } },
      ],
      commandCenter: [
        { id: 'h1', on: true, max: null, conds: [{ kind: 'count', what: 'scv', op: '<', n: 16 }], act: { kind: 'train', def: 'scv' } },
      ],
      barracks: [
        { id: 'i1', on: true, max: null, conds: [{ kind: 'count', what: 'marine', op: '<', n: 6 }], act: { kind: 'train', def: 'marine' } },
        { id: 'i2', on: true, max: null, conds: [], act: { kind: 'train', def: 'marauder' } },
      ],
      factory: [{ id: 'm1', on: true, max: null, conds: [], act: { kind: 'train', def: 'siegeTank' } }],
      starport: [{ id: 'p1', on: true, max: null, conds: [], act: { kind: 'train', def: 'banshee' } }],
    },
    layout: DEFAULT_LAYOUT(),
  };
}
