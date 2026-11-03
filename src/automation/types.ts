/**
 * The automation language. A Program is plain JSON data:
 *
 *  - rules[scope]: ordered "gambit" lists. Every Gatherer (say) runs the FIRST rule
 *    whose conditions hold and whose action is possible right now. If that is the rule
 *    it is already following, it keeps going; otherwise it switches.
 *    Fighters run their own type's list, then the shared `army` list.
 *    Buildings run their list whenever their training queue is empty.
 *    `base` rules all fire whenever their conditions hold (posture switches, extra buildings).
 *  - order: the build order, run one step at a time from the top.
 *  - layout: where buildings go, relative to the main Home, plus the army's muster point.
 */
import type { DefId, ResourceType } from '../sim/defs';

export type Posture = 'economy' | 'defense' | 'offense';
export type Op = '<' | '>=';

export type CountWhat = DefId | 'army';
export type Place = 'self' | 'home' | DefId;
export type NeedWhere = 'any' | 'blueprint' | DefId;
export type DeliverTo = 'home' | 'needy' | DefId;
export type HaulFrom = 'home' | DefId;
export type HaulTo = 'needy' | 'blueprint' | DefId;
export type Dest = 'muster' | 'home' | 'enemy';

export type Condition =
  | { kind: 'posture'; is: Posture }
  | { kind: 'count'; what: CountWhat; op: Op; n: number }
  | { kind: 'has'; def: DefId; not: boolean }
  | { kind: 'stock'; at: Place; res: ResourceType; op: Op; n: number }
  | { kind: 'needs'; res: ResourceType; where: NeedWhere; not: boolean }
  | { kind: 'enemyNear'; r: number; not: boolean }
  | { kind: 'hp'; op: Op; pct: number }
  | { kind: 'carrying'; not: boolean }
  | { kind: 'time'; op: Op; s: number };

export type Action =
  | { kind: 'gather'; res: ResourceType; to: DeliverTo }
  | { kind: 'haul'; res: ResourceType; from: HaulFrom; to: HaulTo }
  | { kind: 'attack' }
  | { kind: 'attackMove'; to: Dest }
  | { kind: 'move'; to: Dest }
  | { kind: 'hold' }
  | { kind: 'train'; def: DefId }
  | { kind: 'build'; def: DefId }
  | { kind: 'setPosture'; to: Posture };

export type Rule = {
  id: string;
  on: boolean;
  /** At most this many units may follow the rule at once (unit scopes only). */
  max: number | null;
  conds: Condition[];
  act: Action;
};

export type Step =
  | { id: string; kind: 'build'; def: DefId }
  | { id: string; kind: 'train'; def: DefId; n: number }
  | { id: string; kind: 'wait'; cond: Condition }
  | { id: string; kind: 'setPosture'; to: Posture };

export type ScopeId = DefId | 'army' | 'base';

export type Slot = { def: DefId; dx: number; dy: number };
export type Layout = { slots: Slot[]; muster: { dx: number; dy: number } };

export type Program = {
  v: 1;
  rules: Partial<Record<ScopeId, Rule[]>>;
  order: Step[];
  layout: Layout;
};

/** Interpreter state that lives in the World (so it is part of the deterministic sim). */
export type AutoState = {
  posture: Posture;
  /** Index of the current build-order step. */
  step: number;
  /** Why the current step is waiting (shown in the editor). */
  stepStatus: string;
  /** Tick each rule key last fired (buildings and base rules), for the editor's live view. */
  fired: Record<string, number>;
};

export const ruleKey = (scope: ScopeId, rule: Rule) => `${scope}#${rule.id}`;
