/**
 * The production view's model: the tech tree, and "keep N" targets that read and write
 * ordinary rules, so the Build order tab and the per-building / Base tabs stay in sync.
 *
 *   unit X keep N      <=>  rule in X's building:  if count of X < N → train X
 *   unit X always      <=>  rule in X's building:  always → train X
 *   building B keep N  <=>  Base rule:             if count of B < N → build B
 */
import { DEFS, type DefId } from '../sim/defs';
import { newId } from './blocks';
import type { Program, Rule, ScopeId, Step } from './types';

export type Keep = number | 'always' | null;

/** Buildings in tech order, each with the units it trains. */
export const TECH: { building: DefId; units: DefId[] }[] = (['home', 'infantryTraining', 'mechFactory', 'port'] as DefId[]).map(
  (building) => ({ building, units: [...(DEFS[building].trains ?? [])] }),
);

export const isBuildingDef = (def: DefId) => DEFS[def].category === 'building';

/** The building type that trains a unit. */
export function trainerOf(unit: DefId): DefId {
  return TECH.find((t) => t.units.includes(unit))!.building;
}

/** Where a def's keep rule lives. */
export const keepScope = (def: DefId): ScopeId => (isBuildingDef(def) ? 'base' : trainerOf(def));

function isKeepRule(rule: Rule, def: DefId): Keep | undefined {
  const act = rule.act;
  const kind = isBuildingDef(def) ? 'build' : 'train';
  if (act.kind !== kind || act.def !== def) return undefined;
  if (rule.conds.length === 0) return kind === 'train' ? 'always' : undefined;
  if (rule.conds.length !== 1) return undefined;
  const c = rule.conds[0];
  if (c.kind === 'count' && c.what === def && c.op === '<') return c.n;
  return undefined;
}

/** The first rule that expresses a keep target for `def`, if any. */
export function findKeep(p: Program, def: DefId): { rule: Rule; index: number; value: Keep } | undefined {
  const list = p.rules[keepScope(def)] ?? [];
  for (let i = 0; i < list.length; i++) {
    const value = isKeepRule(list[i], def);
    if (value !== undefined) return { rule: list[i], index: i, value: list[i].on ? value : null };
  }
  return undefined;
}

export const getKeep = (p: Program, def: DefId): Keep => findKeep(p, def)?.value ?? null;

/** Set a keep target by editing (or adding / removing) that one rule. */
export function setKeep(p: Program, def: DefId, value: Keep): void {
  const scope = keepScope(def);
  const list = (p.rules[scope] ??= []);
  const found = findKeep(p, def);
  if (value === null) {
    if (found) list.splice(found.index, 1);
    if (list.length === 0) delete p.rules[scope];
    return;
  }
  if (value === 'always' && isBuildingDef(def)) value = 1;
  const conds: Rule['conds'] = value === 'always' ? [] : [{ kind: 'count', what: def, op: '<', n: value }];
  if (found) {
    found.rule.conds = conds;
    found.rule.on = true;
    return;
  }
  const act: Rule['act'] = isBuildingDef(def) ? { kind: 'build', def } : { kind: 'train', def };
  list.push({ id: newId(), on: true, max: null, conds, act });
}

/** Rules that also build / train `def` but aren't its keep rule (shown as "also" in the view). */
export function otherRules(p: Program, def: DefId): { scope: ScopeId; index: number; rule: Rule }[] {
  const scope = keepScope(def);
  const keep = findKeep(p, def);
  const kind = isBuildingDef(def) ? 'build' : 'train';
  return (p.rules[scope] ?? [])
    .map((rule, index) => ({ scope, index, rule }))
    .filter(({ rule }) => rule !== keep?.rule && rule.act.kind === kind && (rule.act as { def: DefId }).def === def);
}

/** A build-order step for `def`, continuing from the steps already there. */
export function stepFor(p: Program, def: DefId): Step {
  if (isBuildingDef(def)) return { id: newId(), kind: 'build', def };
  const prev = p.order.filter((s): s is Extract<Step, { kind: 'train' }> => s.kind === 'train' && s.def === def);
  const base = prev.length ? Math.max(...prev.map((s) => s.n)) : def === 'gatherer' ? 4 : 0;
  return { id: newId(), kind: 'train', def, n: base + 1 };
}

export const KEEP_OPTIONS = (def: DefId): Keep[] =>
  isBuildingDef(def) ? [null, 1, 2, 3, 4, 5, 6] : [null, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 30, 40, 'always'];

export const keepLabel = (k: Keep): string => (k === null ? 'off' : k === 'always' ? 'always' : `keep ${k}`);
