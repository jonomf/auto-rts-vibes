/**
 * Block schema: every condition, action and build-order step, as words and fields.
 * The editor renders each block as a sentence of chips from this; `describe*` renders
 * plain text; `sanitizeProgram` uses it to validate imported JSON.
 */
import { DEF_ALIASES, DEFS, type DefId } from '../sim/defs';
import type { Action, Condition, Program, Rule, ScopeId, Step } from './types';

export type Role = 'cond' | 'act' | 'step';
export type Scalar = string | number | boolean;
export type Opt = { v: Scalar; label: string };

export type Field =
  | { key: string; type: 'enum'; options: (scope: ScopeId) => Opt[] }
  | { key: string; type: 'number'; min: number; max: number; step: number; fmt?: (n: number) => string };

/** A sentence token: literal text, or a field shown as a chip. `nested` = the wait step's condition. */
export type Token = string | { f: string } | { nested: 'cond' };

export type Schema = {
  kind: string;
  role: Role;
  /** First chip (click to change kind). A pair means the block has a `not` flag: [normal, negated]. */
  head: string | [string, string];
  tokens: Token[];
  fields: Field[];
  help: string;
  allowed: (scope: ScopeId) => boolean;
  make: (scope: ScopeId) => Record<string, unknown>;
};

// ---- Scopes ---------------------------------------------------------------------------

export const UNIT_SCOPES = [
  'scv',
  'army',
  'marine',
  'marauder',
  'medic',
  'hellion',
  'siegeTank',
  'viking',
  'medivac',
  'banshee',
] as const satisfies readonly ScopeId[];
export const BUILDING_SCOPES = ['commandCenter', 'barracks', 'factory', 'starport'] as const satisfies readonly ScopeId[];
export const ALL_SCOPES: ScopeId[] = ['base', ...UNIT_SCOPES, ...BUILDING_SCOPES];

export type ScopeKind = 'base' | 'unit' | 'building';
export const scopeKind = (s: ScopeId): ScopeKind =>
  s === 'base' ? 'base' : s === 'army' || DEFS[s as DefId]?.category === 'unit' ? 'unit' : 'building';
export const isFighterScope = (s: ScopeId) => s === 'army' || (scopeKind(s) === 'unit' && s !== 'scv' && !DEFS[s as DefId]?.heal);
const canSiege = (s: ScopeId) => s === 'army' || s === 'siegeTank';
const canStim = (s: ScopeId) => s === 'army' || !!DEFS[s as DefId]?.stim;
const hasAddons = (s: ScopeId) => !!DEFS[s as DefId]?.addons;

export const scopeName = (s: ScopeId) => (s === 'base' ? 'Base' : s === 'army' ? 'Army' : DEFS[s as DefId].name);

// ---- Option lists -------------------------------------------------------------------------

const BUILDINGS: DefId[] = ['commandCenter', 'supplyDepot', 'refinery', 'barracks', 'factory', 'starport'];
const STOCK_BUILDINGS: DefId[] = ['commandCenter', 'barracks', 'factory', 'starport'];
const PRODUCTION: DefId[] = ['barracks', 'factory', 'starport'];
const UNITS: DefId[] = ['scv', 'marine', 'marauder', 'medic', 'hellion', 'siegeTank', 'viking', 'medivac', 'banshee'];
const ADDONS: Opt[] = [
  { v: 'techLab', label: 'Tech Lab' },
  { v: 'reactor', label: 'Reactor' },
];

const defOpts = (defs: DefId[]): Opt[] => defs.map((d) => ({ v: d, label: DEFS[d].name }));
const RES: Opt[] = [
  { v: 'minerals', label: 'minerals' },
  { v: 'gas', label: 'gas' },
];
const OP: Opt[] = [
  { v: '<', label: '<' },
  { v: '>=', label: '≥' },
];
const POSTURE: Opt[] = [
  { v: 'economy', label: 'economy' },
  { v: 'defense', label: 'defense' },
  { v: 'offense', label: 'offense' },
];
const DEST: Opt[] = [
  { v: 'muster', label: 'muster point' },
  { v: 'home', label: 'Command Center' },
  { v: 'enemy', label: 'enemy base' },
];

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const anyScope = () => true;
const unitOnly = (s: ScopeId) => scopeKind(s) === 'unit';

// ---- Conditions ----------------------------------------------------------------------------

const CONDITIONS: Schema[] = [
  {
    kind: 'count',
    role: 'cond',
    head: 'count of',
    tokens: [{ f: 'what' }, { f: 'op' }, { f: 'n' }],
    fields: [
      {
        key: 'what',
        type: 'enum',
        options: () => [...defOpts(UNITS), { v: 'army', label: 'army (all fighters)' }, ...defOpts(BUILDINGS), ...ADDONS],
      },
      { key: 'op', type: 'enum', options: () => OP },
      { key: 'n', type: 'number', min: 0, max: 200, step: 1 },
    ],
    help: 'How many you have, counting queued units, blueprints and buildings on the way.',
    allowed: anyScope,
    make: () => ({ kind: 'count', what: 'scv', op: '<', n: 12 }),
  },
  {
    kind: 'has',
    role: 'cond',
    head: ['has', 'lacks'],
    tokens: [{ f: 'def' }],
    fields: [{ key: 'def', type: 'enum', options: () => defOpts(BUILDINGS) }],
    help: 'Whether a finished building of that type exists.',
    allowed: anyScope,
    make: () => ({ kind: 'has', def: 'barracks', not: false }),
  },
  {
    kind: 'stock',
    role: 'cond',
    head: 'stock at',
    tokens: [{ f: 'at' }, { f: 'res' }, { f: 'op' }, { f: 'n' }],
    fields: [
      {
        key: 'at',
        type: 'enum',
        options: (s) => [...(scopeKind(s) === 'building' ? [{ v: 'self', label: 'this building' }] : []), ...defOpts(STOCK_BUILDINGS)],
      },
      { key: 'res', type: 'enum', options: () => RES },
      { key: 'op', type: 'enum', options: () => OP },
      { key: 'n', type: 'number', min: 0, max: 2000, step: 25 },
    ],
    help: "A building's own stockpile. With several of that type, any one of them counts.",
    allowed: anyScope,
    make: () => ({ kind: 'stock', at: 'commandCenter', res: 'minerals', op: '>=', n: 50 }),
  },
  {
    kind: 'needs',
    role: 'cond',
    head: ['something needs', 'nothing needs'],
    tokens: [{ f: 'res' }, 'at', { f: 'where' }],
    fields: [
      { key: 'res', type: 'enum', options: () => RES },
      {
        key: 'where',
        type: 'enum',
        options: () => [{ v: 'any', label: 'any building' }, { v: 'blueprint', label: 'a blueprint' }, ...defOpts(PRODUCTION)],
      },
    ],
    help: 'Blueprints need their cost delivered. Production buildings want a reserve of 2× their priciest unit. Loads already on the way count.',
    allowed: anyScope,
    make: () => ({ kind: 'needs', res: 'minerals', where: 'any', not: false }),
  },
  {
    kind: 'posture',
    role: 'cond',
    head: 'posture is',
    tokens: [{ f: 'is' }],
    fields: [{ key: 'is', type: 'enum', options: () => POSTURE }],
    help: 'The base-wide posture, set by base rules, the build order, or the top bar.',
    allowed: anyScope,
    make: () => ({ kind: 'posture', is: 'offense' }),
  },
  {
    kind: 'enemyNear',
    role: 'cond',
    head: ['enemy within', 'no enemy within'],
    tokens: [{ f: 'r' }],
    fields: [{ key: 'r', type: 'number', min: 1, max: 40, step: 1 }],
    help: 'An enemy within this distance of the unit or building (of the main Home for base rules).',
    allowed: anyScope,
    make: () => ({ kind: 'enemyNear', r: 8, not: false }),
  },
  {
    kind: 'hp',
    role: 'cond',
    head: 'HP',
    tokens: [{ f: 'op' }, { f: 'pct' }],
    fields: [
      { key: 'op', type: 'enum', options: () => OP },
      { key: 'pct', type: 'number', min: 5, max: 100, step: 5, fmt: (n) => `${n}%` },
    ],
    help: "The unit's health as a percentage.",
    allowed: unitOnly,
    make: () => ({ kind: 'hp', op: '<', pct: 30 }),
  },
  {
    kind: 'carrying',
    role: 'cond',
    head: ['carrying', 'empty-handed'],
    tokens: [],
    fields: [],
    help: 'Whether the gatherer is holding a load.',
    allowed: (s) => s === 'scv',
    make: () => ({ kind: 'carrying', not: false }),
  },
  {
    kind: 'time',
    role: 'cond',
    head: 'time',
    tokens: [{ f: 'op' }, { f: 's' }],
    fields: [
      { key: 'op', type: 'enum', options: () => OP },
      { key: 's', type: 'number', min: 0, max: 3600, step: 15, fmt: fmtTime },
    ],
    help: 'Game clock.',
    allowed: anyScope,
    make: () => ({ kind: 'time', op: '>=', s: 180 }),
  },
  {
    kind: 'supply',
    role: 'cond',
    head: 'supply left',
    tokens: [{ f: 'op' }, { f: 'n' }],
    fields: [
      { key: 'op', type: 'enum', options: () => OP },
      { key: 'n', type: 'number', min: -50, max: 50, step: 1 },
    ],
    help: 'Supply cap minus supply used (queued units count). Supply Depots raise the cap by 8.',
    allowed: anyScope,
    make: () => ({ kind: 'supply', op: '<', n: 4 }),
  },
  {
    kind: 'sieged',
    role: 'cond',
    head: ['sieged', 'not sieged'],
    tokens: [],
    fields: [],
    help: 'Whether this Siege Tank is deployed (or deploying).',
    allowed: canSiege,
    make: () => ({ kind: 'sieged', not: false }),
  },
  {
    kind: 'addon',
    role: 'cond',
    head: 'add-on is',
    tokens: [{ f: 'is' }],
    fields: [{ key: 'is', type: 'enum', options: () => [{ v: 'none', label: 'none' }, ...ADDONS] }],
    help: "This building's add-on (one being built counts).",
    allowed: hasAddons,
    make: () => ({ kind: 'addon', is: 'none' }),
  },
];

// ---- Actions --------------------------------------------------------------------------------

const ACTIONS: Schema[] = [
  {
    kind: 'gather',
    role: 'act',
    head: 'gather',
    tokens: [{ f: 'res' }, '→', { f: 'to' }],
    fields: [
      { key: 'res', type: 'enum', options: () => RES },
      {
        key: 'to',
        type: 'enum',
        options: () => [{ v: 'commandCenter', label: 'Command Center' }, { v: 'needy', label: 'whatever needs it' }, ...defOpts(PRODUCTION)],
      },
    ],
    help: 'Harvest the least-busy field near the drop-off, and carry loads there. Keeps going.',
    allowed: (s) => s === 'scv',
    make: () => ({ kind: 'gather', res: 'minerals', to: 'commandCenter' }),
  },
  {
    kind: 'haul',
    role: 'act',
    head: 'haul',
    tokens: [{ f: 'res' }, 'from', { f: 'from' }, 'to', { f: 'to' }],
    fields: [
      { key: 'res', type: 'enum', options: () => RES },
      { key: 'from', type: 'enum', options: () => defOpts(STOCK_BUILDINGS) },
      {
        key: 'to',
        type: 'enum',
        options: () => [{ v: 'needy', label: 'whatever needs it' }, { v: 'blueprint', label: 'a blueprint' }, ...defOpts(PRODUCTION)],
      },
    ],
    help: 'One trip: take a crate (50 minerals or 25 gas) out of a stockpile and deliver it where it is needed.',
    allowed: (s) => s === 'scv',
    make: () => ({ kind: 'haul', res: 'minerals', from: 'commandCenter', to: 'needy' }),
  },
  {
    kind: 'attack',
    role: 'act',
    head: 'attack nearest enemy',
    tokens: [],
    fields: [],
    help: 'Attack the closest enemy it can hit, within 12.',
    allowed: isFighterScope,
    make: () => ({ kind: 'attack' }),
  },
  {
    kind: 'attackMove',
    role: 'act',
    head: 'attack-move to',
    tokens: [{ f: 'to' }],
    fields: [{ key: 'to', type: 'enum', options: () => DEST }],
    help: 'Walk there, fighting anything met on the way.',
    allowed: isFighterScope,
    make: () => ({ kind: 'attackMove', to: 'enemy' }),
  },
  {
    kind: 'move',
    role: 'act',
    head: 'move to',
    tokens: [{ f: 'to' }],
    fields: [{ key: 'to', type: 'enum', options: () => DEST }],
    help: 'Walk there, ignoring enemies.',
    allowed: unitOnly,
    make: () => ({ kind: 'move', to: 'muster' }),
  },
  {
    kind: 'hold',
    role: 'act',
    head: 'hold position',
    tokens: [],
    fields: [],
    help: 'Stand still. Fighters still shoot back at anything in range.',
    allowed: unitOnly,
    make: () => ({ kind: 'hold' }),
  },
  {
    kind: 'train',
    role: 'act',
    head: 'train',
    tokens: [{ f: 'def' }],
    fields: [{ key: 'def', type: 'enum', options: (s) => defOpts((DEFS[s as DefId]?.trains ?? UNITS) as DefId[]) }],
    help: "Queue one unit when the queue is empty, paid from this building's own stock. If it can't afford it, the next rule gets a turn.",
    allowed: (s) => scopeKind(s) === 'building',
    make: (s) => ({ kind: 'train', def: DEFS[s as DefId]?.trains?.[0] ?? 'scv' }),
  },
  {
    kind: 'build',
    role: 'act',
    head: 'build',
    tokens: [{ f: 'def' }],
    fields: [{ key: 'def', type: 'enum', options: () => defOpts(BUILDINGS) }],
    help: 'Send a gatherer to place a blueprint at the next free layout slot. At most one unfinished blueprint per type from rules.',
    allowed: (s) => s === 'base',
    make: () => ({ kind: 'build', def: 'barracks' }),
  },
  {
    kind: 'setPosture',
    role: 'act',
    head: 'set posture',
    tokens: [{ f: 'to' }],
    fields: [{ key: 'to', type: 'enum', options: () => POSTURE }],
    help: 'Switch the base-wide posture.',
    allowed: (s) => s === 'base',
    make: () => ({ kind: 'setPosture', to: 'offense' }),
  },
  {
    kind: 'siege',
    role: 'act',
    head: 'siege up',
    tokens: [],
    fields: [],
    help: 'Deploy into siege mode: long range splash, but it can’t move. Takes 2 seconds.',
    allowed: canSiege,
    make: () => ({ kind: 'siege' }),
  },
  {
    kind: 'unsiege',
    role: 'act',
    head: 'pack up',
    tokens: [],
    fields: [],
    help: 'Leave siege mode so the tank can move again. Takes 2 seconds.',
    allowed: canSiege,
    make: () => ({ kind: 'unsiege' }),
  },
  {
    kind: 'stim',
    role: 'act',
    head: 'stim',
    tokens: [],
    fields: [],
    help: 'Stimpack: costs HP (10 Marine, 20 Marauder) for 8 seconds of 50% faster moving and shooting.',
    allowed: canStim,
    make: () => ({ kind: 'stim' }),
  },
  {
    kind: 'addon',
    role: 'act',
    head: 'build add-on',
    tokens: [{ f: 'def' }],
    fields: [{ key: 'def', type: 'enum', options: () => ADDONS }],
    help: 'Build a Tech Lab (unlocks advanced units) or Reactor (trains two at once) onto this building, paid from its own stock.',
    allowed: hasAddons,
    make: () => ({ kind: 'addon', def: 'techLab' }),
  },
];

// ---- Build-order steps ------------------------------------------------------------------------

const STEPS: Schema[] = [
  {
    kind: 'build',
    role: 'step',
    head: 'build',
    tokens: [{ f: 'def' }],
    fields: [{ key: 'def', type: 'enum', options: () => defOpts(BUILDINGS) }],
    help: 'Place a blueprint (waits until its tech is ready and a gatherer is free).',
    allowed: anyScope,
    make: () => ({ kind: 'build', def: 'barracks' }),
  },
  {
    kind: 'train',
    role: 'step',
    head: 'train',
    tokens: [{ f: 'def' }, 'until', { f: 'n' }],
    fields: [
      { key: 'def', type: 'enum', options: () => defOpts(UNITS) },
      { key: 'n', type: 'number', min: 1, max: 200, step: 1 },
    ],
    help: 'Queue them wherever they can be afforded until you have this many.',
    allowed: anyScope,
    make: () => ({ kind: 'train', def: 'scv', n: 8 }),
  },
  {
    kind: 'wait',
    role: 'step',
    head: 'wait until',
    tokens: [{ nested: 'cond' }],
    fields: [],
    help: 'Hold the build order until a condition is true.',
    allowed: anyScope,
    make: () => ({ kind: 'wait', cond: { kind: 'count', what: 'scv', op: '>=', n: 10 } }),
  },
  {
    kind: 'setPosture',
    role: 'step',
    head: 'set posture',
    tokens: [{ f: 'to' }],
    fields: [{ key: 'to', type: 'enum', options: () => POSTURE }],
    help: 'Switch the base-wide posture.',
    allowed: anyScope,
    make: () => ({ kind: 'setPosture', to: 'offense' }),
  },
  {
    kind: 'addon',
    role: 'step',
    head: 'add',
    tokens: [{ f: 'def' }, 'to', { f: 'on' }],
    fields: [
      { key: 'def', type: 'enum', options: () => ADDONS },
      { key: 'on', type: 'enum', options: () => defOpts(PRODUCTION) },
    ],
    help: 'Build an add-on onto one building of that type that has none (waits until one can pay for it).',
    allowed: anyScope,
    make: () => ({ kind: 'addon', def: 'techLab', on: 'barracks' }),
  },
];

const byRole: Record<Role, Schema[]> = { cond: CONDITIONS, act: ACTIONS, step: STEPS };

export const schemasFor = (role: Role, scope: ScopeId) => byRole[role].filter((s) => s.allowed(scope));
export const schemaOf = (role: Role, kind: string) => byRole[role].find((s) => s.kind === kind);

// ---- Text -------------------------------------------------------------------------------------

export function headText(sc: Schema, block: Record<string, unknown>): string {
  return typeof sc.head === 'string' ? sc.head : sc.head[block.not ? 1 : 0];
}

export function fieldText(field: Field, value: unknown, scope: ScopeId): string {
  if (field.type === 'number') return field.fmt ? field.fmt(value as number) : String(value);
  const all = field.options(scope).concat(...ALL_SCOPES.map((s) => field.options(s)));
  return all.find((o) => o.v === value)?.label ?? String(value);
}

export function describeBlock(role: Role, block: Record<string, unknown>, scope: ScopeId): string {
  const sc = schemaOf(role, block.kind as string);
  if (!sc) return '?';
  const parts = [headText(sc, block)];
  for (const t of sc.tokens) {
    if (typeof t === 'string') parts.push(t);
    else if ('nested' in t) parts.push(describeBlock('cond', block.cond as Record<string, unknown>, scope));
    else parts.push(fieldText(sc.fields.find((f) => f.key === t.f)!, block[t.f], scope));
  }
  return parts.join(' ');
}

export function describeRule(rule: Rule, scope: ScopeId): string {
  const conds = rule.conds.map((c) => describeBlock('cond', c, scope));
  const when = conds.length ? `if ${conds.join(' and ')}` : 'always';
  return `${when} → ${describeBlock('act', rule.act, scope)}`;
}

/** Program size in blocks: the "mana" budget a later milestone will cap. */
export function nodeCount(p: Program): number {
  let n = 0;
  for (const rules of Object.values(p.rules)) for (const r of rules ?? []) n += 1 + r.conds.length;
  for (const s of p.order) n += s.kind === 'wait' ? 2 : 1;
  return n;
}

// ---- Validation of imported / stored programs ----------------------------------------------

let idCounter = 0;
export const newId = () => `${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function sanitizeBlock<T>(role: Role, raw: unknown, scope: ScopeId): T | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const sc = schemaOf(role, b.kind as string);
  if (!sc || !sc.allowed(scope)) return null;
  const out = sc.make(scope);
  for (const f of sc.fields) {
    const v = b[f.key];
    if (f.type === 'number') {
      if (typeof v === 'number' && isFinite(v)) out[f.key] = Math.min(f.max, Math.max(f.min, v));
    } else {
      const opts = f.options(scope);
      // Old saved programs used earlier names (home, gatherer, ship, ...): map them over.
      const alias = typeof v === 'string' ? DEF_ALIASES[v] : undefined;
      if (opts.some((o) => o.v === v)) out[f.key] = v;
      else if (alias && opts.some((o) => o.v === alias)) out[f.key] = alias;
    }
  }
  if (Array.isArray(sc.head)) out.not = b.not === true;
  if (sc.kind === 'wait' && role === 'step') {
    const c = sanitizeBlock<Condition>('cond', b.cond, 'base');
    if (c) out.cond = c;
  }
  return out as T;
}

/** Accept anything JSON-shaped; keep only what the schema understands. */
export function sanitizeProgram(raw: unknown): Program {
  const p = emptyProgram();
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Record<string, any>;
  // Old scope names (gatherer, infantryTraining, ...) map onto the new ones.
  const rawRules: Record<string, unknown> = {};
  for (const [k, v] of Object.entries((r.rules ?? {}) as Record<string, unknown>)) rawRules[DEF_ALIASES[k] ?? k] = v;
  for (const scope of ALL_SCOPES) {
    const list = rawRules[scope] as any[] | undefined;
    if (!Array.isArray(list)) continue;
    const rules: Rule[] = [];
    for (const item of list) {
      const act = sanitizeBlock<Action>('act', item?.act, scope);
      if (!act) continue;
      const conds = (Array.isArray(item.conds) ? item.conds : [])
        .map((c: unknown) => sanitizeBlock<Condition>('cond', c, scope))
        .filter(Boolean) as Condition[];
      rules.push({
        id: typeof item.id === 'string' ? item.id : newId(),
        on: item.on !== false,
        max: typeof item.max === 'number' && item.max > 0 ? Math.round(item.max) : null,
        conds,
        act,
      });
    }
    if (rules.length) p.rules[scope] = rules;
  }
  if (Array.isArray(r.order))
    for (const item of r.order) {
      const s = sanitizeBlock<Step>('step', item, 'base');
      if (s) p.order.push({ ...s, id: typeof item.id === 'string' ? item.id : newId() });
    }
  if (r.layout && typeof r.layout === 'object') {
    if (Array.isArray(r.layout.slots))
      p.layout.slots = r.layout.slots.map((s: any) => ({ ...s, def: DEF_ALIASES[s?.def] ?? s?.def })).filter(
        (s: any) => BUILDINGS.includes(s?.def) && typeof s.dx === 'number' && typeof s.dy === 'number',
      );
    const m = r.layout.muster;
    if (m && typeof m.dx === 'number' && typeof m.dy === 'number') p.layout.muster = { dx: m.dx, dy: m.dy };
  }
  return p;
}

export const DEFAULT_LAYOUT = (): Program['layout'] => ({
  // Relative to the main Command Center. Production columns leave room on the right for add-ons.
  slots: [
    { def: 'supplyDepot', dx: -6, dy: -12 },
    { def: 'supplyDepot', dx: -3.5, dy: -12 },
    { def: 'supplyDepot', dx: -1, dy: -12 },
    { def: 'supplyDepot', dx: 1.5, dy: -12 },
    { def: 'supplyDepot', dx: -6, dy: 12 },
    { def: 'supplyDepot', dx: -3.5, dy: 12 },
    { def: 'supplyDepot', dx: -1, dy: 12 },
    { def: 'supplyDepot', dx: 1.5, dy: 12 },
    { def: 'barracks', dx: 7, dy: -5 },
    { def: 'barracks', dx: 7, dy: 4 },
    { def: 'barracks', dx: 7, dy: -10 },
    { def: 'factory', dx: 14, dy: -5 },
    { def: 'factory', dx: 14, dy: 4 },
    { def: 'starport', dx: 14, dy: -10 },
    { def: 'starport', dx: 7, dy: 9 },
    { def: 'starport', dx: 14, dy: 9 },
    { def: 'commandCenter', dx: 19.5, dy: 14.5 },
  ],
  muster: { dx: 20, dy: -0.5 },
});

export function emptyProgram(): Program {
  return { v: 1, rules: {}, order: [], layout: DEFAULT_LAYOUT() };
}
