/**
 * Program editor: a drawer of scope tabs, each holding rules written as sentences
 * of clickable word-chips ("if [count of] [Gatherer] [<] [16] → [train] [Gatherer]").
 * Clicking a chip opens a small menu to change that word.
 */
import { DEFS, type DefId } from '../sim/defs';
import { isUnit } from '../sim/actions';
import { PLAYER } from '../sim/types';
import type { Game } from '../game';
import {
  ALL_SCOPES,
  BUILDING_SCOPES,
  DEFAULT_LAYOUT,
  UNIT_SCOPES,
  describeRule,
  emptyProgram,
  fieldText,
  headText,
  newId,
  nodeCount,
  sanitizeProgram,
  schemaOf,
  schemasFor,
  scopeKind,
  scopeName,
  type Field,
  type Role,
  type Schema,
} from '../automation/blocks';
import { starterProgram } from '../automation/presets';
import { missingRequirement } from '../sim/actions';
import { DEFS as D, costOf, formatCost } from '../sim/defs';
import {
  KEEP_OPTIONS,
  TECH,
  findKeep,
  isBuildingDef,
  keepLabel,
  keepScope,
  otherRules,
  setKeep,
  stepFor,
  trainerOf,
} from '../automation/production';
import { ruleKey, type Condition, type Rule, type ScopeId, type Step } from '../automation/types';
import { icon } from './icons';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type Block = Record<string, unknown>;
type Ref = { role: Role; scope: ScopeId; get: () => Block; set: (b: Block) => void; remove?: () => void };
type MenuItem = { label: string; help?: string; current?: boolean; danger?: boolean; divider?: boolean; run?: () => void };

const SCOPE_HELP: Record<string, string> = {
  build:
    'Everything you build, in one place. Steps run top to bottom, one at a time. Below them, every building and unit in tech order: add it as a step, or give it a standing “keep” target. A keep target is an ordinary rule, so it also shows (and can be edited) in that building’s tab or in Base.',
  base: 'Base rules fire whenever their conditions hold. The build order has its own tab.',
  unit: 'Each unit follows the first rule whose conditions hold and whose action is possible. A rule higher up interrupts one lower down.',
  army: 'Every fighter runs its own type’s rules first, then these.',
  building: 'Whenever the training queue is empty, the first rule that holds and can be paid for from this building’s own stock trains a unit.',
};

const MAX_OPTIONS = [null, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16];

/** One-click starting rules for empty scopes. */
const SUGGEST: Partial<Record<ScopeId, () => Rule[]>> = {
  scv: () => [r([], { kind: 'gather', res: 'minerals', to: 'commandCenter' })],
  army: () => [
    r([{ kind: 'enemyNear', r: 8, not: false }], { kind: 'attack' }),
    r([{ kind: 'posture', is: 'offense' }], { kind: 'attackMove', to: 'enemy' }),
    r([], { kind: 'move', to: 'muster' }),
  ],
  commandCenter: () => [r([{ kind: 'count', what: 'scv', op: '<', n: 16 }], { kind: 'train', def: 'scv' })],
  barracks: () => [r([], { kind: 'train', def: 'marine' })],
  factory: () => [r([], { kind: 'train', def: 'siegeTank' })],
  starport: () => [r([], { kind: 'train', def: 'banshee' })],
  base: () => [r([{ kind: 'count', what: 'army', op: '>=', n: 12 }], { kind: 'setPosture', to: 'offense' })],
};

function r(conds: Condition[], act: Rule['act'], max: number | null = null): Rule {
  return { id: newId(), on: true, max, conds, act };
}

export class Editor {
  private readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly head: HTMLElement;
  private readonly pop: HTMLElement;
  private readonly modal: HTMLElement;
  private menu: MenuItem[] = [];
  private popAnchor: string | null = null;
  private numberRef: { ref: Ref; field: Extract<Field, { type: 'number' }> } | null = null;
  private armed: { cmd: string; until: number } | null = null;
  private version = -1;
  private wasOpen = false;
  /** Rule or step id that was just added (the edit-pause note sits under it). */
  private newItemId: string | null = null;
  private noteShown = false;

  constructor(app: HTMLElement, private readonly game: Game) {
    this.el = app.querySelector<HTMLElement>('[data-prog]')!;
    this.el.innerHTML = `
      <div class="prog-head" data-prog-head></div>
      <nav class="scopes" data-tabs></nav>
      <div class="prog-body" data-body></div>
      <div class="pop" data-pop hidden></div>
      <div class="modal" data-modal hidden></div>`;
    this.head = this.el.querySelector('[data-prog-head]')!;
    this.tabs = this.el.querySelector('[data-tabs]')!;
    this.body = this.el.querySelector('[data-body]')!;
    this.pop = this.el.querySelector('[data-pop]')!;
    this.modal = this.el.querySelector('[data-modal]')!;

    this.el.addEventListener('click', (e) => this.onClick(e));
    this.pop.addEventListener('click', (e) => this.onPopClick(e));
    this.pop.addEventListener('input', (e) => this.onPopInput(e));
    this.pop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') this.closePop();
      e.stopPropagation();
    });
    this.modal.addEventListener('keydown', (e) => e.stopPropagation());
    document.addEventListener('pointerdown', (e) => {
      if (!this.pop.hidden && !this.pop.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.chip'))
        this.closePop();
    });
    // Keep an open menu attached to its chip while the panel scrolls.
    this.body.addEventListener('scroll', () => this.reposition());
  }

  /** Called by the HUD loop. Re-renders when the program changes; otherwise only updates live stats. */
  update(): void {
    const g = this.game;
    this.el.classList.toggle('open', g.programsOpen);
    this.el.parentElement?.classList.toggle('prog-open', g.programsOpen);
    if (!g.programsOpen) {
      if (this.wasOpen) this.closePop();
      this.wasOpen = false;
      return;
    }
    if (!this.wasOpen || this.version !== g.programVersion) {
      this.version = g.programVersion;
      this.wasOpen = true;
      this.render();
    }
    this.live();
  }

  // ---- Rendering ----------------------------------------------------------------------

  private render(): void {
    const g = this.game;
    const p = g.program;
    this.head.innerHTML = `
      <div class="ttl"><span>Program</span><span class="nodes" title="Program size in blocks">${nodeCount(p)} blocks</span></div>
      <div class="tools">
        <button data-cmd="starter" title="Replace the program with a complete example">${this.armedLabel('starter', 'Load starter')}</button>
        <button data-cmd="clear" title="Remove every rule and step">${this.armedLabel('clear', 'Clear')}</button>
        <button data-cmd="json" title="Copy or paste the program as JSON">JSON</button>
        <button data-cmd="close" class="x" title="Close (P)">✕</button>
      </div>`;

    const tab = (s: ScopeId | 'build') => {
      const n = s === 'build' ? p.order.length : (p.rules[s]?.length ?? 0);
      const ic = s === 'build' ? icon('program') : s === 'base' ? icon('build') : s === 'army' ? icon('attack') : icon(s as DefId);
      const name = s === 'build' ? 'Build order' : scopeName(s);
      const what = s === 'build' ? 'step' : 'rule';
      return `<button class="tab${g.scope === s ? ' on' : ''}${n ? '' : ' norules'}${s === 'build' ? ' build' : ''}" data-scope="${s}" data-count="${s}" title="${esc(name)}">${ic}<span>${esc(s === 'build' ? name : shortName(s))}</span>${n ? `<i title="${n} ${what}${n === 1 ? '' : 's'}">${n}</i>` : ''}</button>`;
    };
    this.tabs.innerHTML = `
      <div class="grp">${tab('build')}${tab('base')}<span class="div"></span>${UNIT_SCOPES.map(tab).join('')}</div>
      <div class="grp">${BUILDING_SCOPES.map(tab).join('')}</div>`;

    if (g.scope === 'build') {
      this.body.innerHTML = this.buildHtml();
      this.afterBodyRender();
      return;
    }
    const s = g.scope;
    const kind = scopeKind(s);
    const help = s === 'army' ? `${SCOPE_HELP.army} ${SCOPE_HELP.unit}` : SCOPE_HELP[kind];
    let html = `<div class="scope-head"><h3>${esc(scopeName(s))}</h3><p>${esc(help)}</p></div>`;

    if (s === 'base') {
      html += `<p class="note">Build-order steps and per-building targets live in the <button class="link" data-scope="build">Build order</button> tab.</p>`;
      html += `<section><h4>Base rules</h4>${this.rulesHtml('base')}</section>`;
      html += `<section><h4>Layout</h4>${this.layoutHtml()}</section>`;
    } else {
      if (scopeKind(s) === 'unit' && s !== 'army' && s !== 'scv')
        html += `<p class="note">Falls through to the <button class="link" data-scope="army">Army</button> rules.</p>`;
      html += this.rulesHtml(s);
    }
    this.body.innerHTML = html;
    this.afterBodyRender();
  }

  private afterBodyRender(): void {
    this.noteShown = !!this.body.querySelector('.editpause');
    if (this.popAnchor) this.reposition();
  }

  private armedLabel(cmd: string, label: string): string {
    return this.armed?.cmd === cmd && this.armed.until > performance.now() ? 'Click again to confirm' : label;
  }

  private rulesHtml(scope: ScopeId): string {
    const rules = this.game.program.rules[scope] ?? [];
    const unitScope = scopeKind(scope) === 'unit';
    const rows = rules.map((rule, i) => {
      const path = `R|${scope}|${i}`;
      const conds = rule.conds.length
        ? rule.conds
            .map((c, ci) => (ci ? '<span class="w">and</span>' : '<span class="w">if</span>') + this.blockHtml('cond', c, `C|${scope}|${i}|${ci}`, scope))
            .join(' ')
        : '<span class="w always">always</span>';
      const max = unitScope
        ? `<button class="chip k-max" data-path="${path}" data-field="max" title="How many units may follow this rule at once">${rule.max == null ? 'all' : `max ${rule.max}`}</button>`
        : '';
      return `<div class="rule${rule.on ? '' : ' off'}" data-key="${esc(ruleKey(scope, rule))}">
        <div class="gut"><span class="idx">${i + 1}</span><button class="sw${rule.on ? ' on' : ''}" data-act="toggle" data-path="${path}" title="${rule.on ? 'Turn off' : 'Turn on'}"></button></div>
        <div class="sentence">${max}${conds}<button class="add" data-act="addcond" data-path="${path}" title="Add a condition">+ if</button><span class="arrow">→</span>${this.blockHtml('act', rule.act, `A|${scope}|${i}`, scope)}</div>
        <div class="side"><span class="live" data-live="${esc(ruleKey(scope, rule))}"></span>
          <button data-act="up" data-path="${path}" title="Move up (higher priority)"${i === 0 ? ' disabled' : ''}>↑</button>
          <button data-act="down" data-path="${path}" title="Move down"${i === rules.length - 1 ? ' disabled' : ''}>↓</button>
          <button data-act="del" data-path="${path}" title="Delete rule">✕</button></div>
      </div>${this.noteFor(rule.id, 'rule')}`;
    });
    const suggest = SUGGEST[scope];
    const empty =
      rules.length === 0
        ? `<div class="empty"><p>${scope === 'base' ? 'No base rules.' : `No rules: ${esc(scopeName(scope))} units will stand still.`}</p>${
            suggest
              ? `<button class="suggest" data-act="suggest" data-scope-arg="${scope}">Add: ${esc(
                  suggest()
                    .map((x) => describeRule(x, scope))
                    .join(' · '),
                )}</button>`
              : ''
          }</div>`
        : '';
    return `<div class="rules">${rows.join('')}</div>${empty}<button class="addrule" data-act="addrule" data-scope-arg="${scope}">+ Rule</button>`;
  }

  // ---- Build order view ---------------------------------------------------------------------

  private buildHtml(): string {
    let html = `<div class="scope-head"><h3>Build order</h3><p>${esc(SCOPE_HELP.build)}</p></div>`;
    html += `<section><h4>Steps</h4>${this.stepsHtml()}</section>`;
    html += `<section><h4>Tech tree</h4><div class="tech">${TECH.map((t) => this.techGroupHtml(t.building, t.units)).join('')}</div></section>`;
    return html;
  }

  private techGroupHtml(building: DefId, units: DefId[]): string {
    const rows = [this.techRowHtml(building, false), ...units.map((u) => this.techRowHtml(u, true))];
    return `<div class="tgroup">${rows.join('')}</div>`;
  }

  private techRowHtml(def: DefId, isUnit: boolean): string {
    const p = this.game.program;
    const d = D[def];
    const keep = findKeep(p, def);
    const scope = keepScope(def);
    const scopeLabel = scope === 'base' ? 'Base' : scopeName(scope);
    const cost = formatCost(costOf(def));
    const meta = isUnit ? `${cost} · ${d.buildTime}s · at ${esc(D[trainerOf(def)].name)}` : cost;
    const keepChip = `<button class="chip k-keep${keep && keep.value !== null ? ' set' : ''}" data-path="K|${def}" data-field="keep" title="Standing target: a rule in ${esc(scopeLabel)}">${esc(keepLabel(keep?.value ?? null))}</button>`;
    const list = p.rules[scope] ?? [];
    const order =
      isUnit && keep
        ? `<span class="prio" title="Priority in ${esc(scopeLabel)}: rules higher up train first">#${keep.index + 1}</span>
           <button data-act="up" data-path="R|${scope}|${keep.index}" title="Train before others"${keep.index === 0 ? ' disabled' : ''}>↑</button>
           <button data-act="down" data-path="R|${scope}|${keep.index}" title="Train after others"${keep.index === list.length - 1 ? ' disabled' : ''}>↓</button>`
        : '';
    const others = otherRules(p, def)
      .map(
        (o) =>
          `<button class="also" data-scope="${o.scope}" title="Open ${esc(o.scope === 'base' ? 'Base' : scopeName(o.scope))} rules">also: ${esc(describeRule(o.rule, o.scope))}</button>`,
      )
      .join('');
    return `<div class="trow${isUnit ? ' unit' : ' bld'}" data-tech="${def}">
      <div class="tname">${icon(def)}<span><b>${esc(d.name)}</b><small>${meta}</small></span></div>
      <div class="tstate"><span class="lock" data-lock="${def}"></span><span class="have" data-have="${def}"></span></div>
      <div class="tact"><button class="stepbtn" data-act="stepfor" data-def="${def}" title="Add a ${isUnit ? 'train' : 'build'} step to the build order">+ step</button>${keepChip}${order}</div>
      ${others ? `<div class="others">${others}</div>` : ''}
    </div>`;
  }

  /** Per-frame text for the tech tree: unlocked or not, and how many you have. */
  private liveTech(): void {
    const w = this.game.world;
    const have = new Map<DefId, number>();
    const pending = new Map<DefId, number>();
    const add = (m: Map<DefId, number>, k: DefId) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const e of w.all()) {
      if (e.team !== PLAYER || D[e.def].inert) continue;
      if (D[e.def].category === 'building' && !e.complete) add(pending, e.def);
      else add(have, e.def);
      for (const q of e.queue) add(pending, q.def);
      if (e.order.type === 'build') add(pending, e.order.def);
    }
    for (const el of this.body.querySelectorAll<HTMLElement>('[data-have]')) {
      const def = el.dataset.have as DefId;
      const n = have.get(def) ?? 0;
      const q = pending.get(def) ?? 0;
      const txt = `${n}${q ? ` +${q}` : ''}`;
      if (el.textContent !== txt) el.textContent = txt;
      el.title = `${n} on the map${q ? `, ${q} ${isBuildingDef(def) ? 'being built' : 'queued'}` : ''}`;
    }
    for (const el of this.body.querySelectorAll<HTMLElement>('[data-lock]')) {
      const def = el.dataset.lock as DefId;
      const need = isBuildingDef(def) ? missingRequirement(w, PLAYER, def) : w.hasCompleted(PLAYER, trainerOf(def)) ? undefined : trainerOf(def);
      const txt = need ? `needs ${D[need].name}` : '';
      if (el.textContent !== txt) el.textContent = txt;
      el.closest('.trow')?.classList.toggle('locked', !!need);
    }
  }

  private showNote(): boolean {
    return this.game.paused && this.game.editPause && this.newItemId !== null;
  }

  /** "Paused so you can set this up" note, placed right under the rule or step just added. */
  private noteFor(id: string, what: 'rule' | 'step'): string {
    if (id !== this.newItemId || !this.showNote()) return '';
    return `<div class="editpause" role="status"><span class="ic">❚❚</span><span>Game paused so you can set up this ${what}. Click its words to change them.</span><button data-act="resume">Resume ▶</button></div>`;
  }

  private stepsHtml(): string {
    const order = this.game.program.order;
    const rows = order.map((s, i) => {
      const path = `S|${i}`;
      return `<div class="rule step" data-step="${i}">
        <div class="gut"><span class="idx">${i + 1}</span><span class="mark" data-stepmark="${i}"></span></div>
        <div class="sentence">${this.blockHtml('step', s as unknown as Block, path, 'base')}<span class="status" data-stepstatus="${i}"></span></div>
        <div class="side">
          <button data-act="up" data-path="${path}"${i === 0 ? ' disabled' : ''} title="Move up">↑</button>
          <button data-act="down" data-path="${path}"${i === order.length - 1 ? ' disabled' : ''} title="Move down">↓</button>
          <button data-act="del" data-path="${path}" title="Delete step">✕</button></div>
      </div>${this.noteFor(s.id, 'step')}`;
    });
    const adders = schemasFor('step', 'base')
      .map((sc) => `<button class="addrule" data-act="addstep" data-kind="${sc.kind}">+ ${esc(headText(sc, {}))}</button>`)
      .join('');
    const empty = order.length === 0 ? '<div class="empty"><p>No build order. Add steps below.</p></div>' : '';
    return `<div class="rules">${rows.join('')}</div>${empty}<div class="adders">${adders}</div>`;
  }

  private layoutHtml(): string {
    const g = this.game;
    const lay = g.program.layout;
    const editing = g.mode.type === 'layout';
    const counts = new Map<DefId, number>();
    for (const s of lay.slots) counts.set(s.def, (counts.get(s.def) ?? 0) + 1);
    const summary = [...counts].map(([d, n]) => `${n}× ${esc(DEFS[d].name)}`).join(', ') || 'no slots';
    let html = `<p class="note">Automated builds use the next free slot of their type, then any open ground near Home. Slots: ${summary}.</p>`;
    html += `<div class="adders"><button class="addrule${editing ? ' on' : ''}" data-act="layout">${editing ? 'Done editing layout' : 'Edit layout on map'}</button><button class="addrule" data-act="layoutreset">Reset layout</button></div>`;
    if (editing) {
      const cur = (g.mode as { def: string }).def;
      const pal = (['barracks', 'factory', 'starport', 'commandCenter'] as const)
        .map((d) => `<button class="chip k-act${cur === d ? ' cur' : ''}" data-act="palette" data-def="${d}">${icon(d)}${esc(DEFS[d].name)}</button>`)
        .join('');
      html += `<div class="palette">${pal}<button class="chip k-cond${cur === 'muster' ? ' cur' : ''}" data-act="palette" data-def="muster">${icon('attack')}Muster point</button></div>
        <p class="note">Click the map to add a slot (or move the muster point). Right-click a slot to remove it. <kbd>Esc</kbd> when done.</p>`;
    }
    return html;
  }

  private blockHtml(role: Role, block: Block, path: string, scope: ScopeId): string {
    const sc = schemaOf(role, block.kind as string);
    if (!sc) return '<span class="w">?</span>';
    const cls = role === 'cond' ? 'k-cond' : 'k-act';
    const parts = [`<button class="chip ${cls} head" data-path="${path}" data-head title="${esc(sc.help)}">${esc(headText(sc, block))}</button>`];
    for (const t of sc.tokens) {
      if (typeof t === 'string') parts.push(`<span class="w">${esc(t)}</span>`);
      else if ('nested' in t) parts.push(this.blockHtml('cond', block.cond as Block, path.replace(/^S/, 'W'), scope));
      else {
        const f = sc.fields.find((x) => x.key === t.f)!;
        parts.push(`<button class="chip ${cls} val" data-path="${path}" data-field="${f.key}">${esc(fieldText(f, block[f.key], scope))}</button>`);
      }
    }
    return `<span class="block">${parts.join(' ')}</span>`;
  }

  // ---- Live view ------------------------------------------------------------------------

  private live(): void {
    const g = this.game;
    if (this.showNote() !== this.noteShown) {
      if (!this.showNote()) this.newItemId = null;
      this.render();
    }
    const w = g.world;
    const intents = new Map<string, number>();
    const byDef = new Map<string, number>();
    for (const e of w.all()) {
      if (e.team !== PLAYER || DEFS[e.def].inert) continue;
      if (e.intent) intents.set(e.intent, (intents.get(e.intent) ?? 0) + 1);
      byDef.set(e.def, (byDef.get(e.def) ?? 0) + 1);
      if (DEFS[e.def].attack && isUnit(e)) byDef.set('army', (byDef.get('army') ?? 0) + 1);
    }
    for (const el of this.el.querySelectorAll<HTMLElement>('[data-live]')) {
      const key = el.dataset.live!;
      const n = intents.get(key) ?? 0;
      const fired = w.auto.fired[key];
      const recent = fired !== undefined && w.tick - fired < 30;
      const txt = n ? `● ${n}` : recent ? '▶' : '';
      if (el.textContent !== txt) el.textContent = txt;
      el.classList.toggle('flash', recent && !n);
    }
    for (const el of this.tabs.querySelectorAll<HTMLElement>('[data-count]')) {
      const s = el.dataset.count!;
      const n = byDef.get(s) ?? 0;
      el.title =
        s === 'build' ? 'Build order' : s === 'base' || s === 'army' ? scopeName(s) : `${scopeName(s as ScopeId)} · ${n} on the map`;
    }
    if (this.game.scope === 'build') this.liveTech();
    // Build order progress.
    for (const el of this.body.querySelectorAll<HTMLElement>('.rule.step[data-step]')) {
      const i = Number(el.dataset.step);
      const state = i < w.auto.step ? 'done' : i === w.auto.step ? 'current' : '';
      el.classList.toggle('done', state === 'done');
      el.classList.toggle('current', state === 'current');
      const mark = el.querySelector<HTMLElement>('[data-stepmark]')!;
      const m = state === 'done' ? '✓' : state === 'current' ? '▶' : '';
      if (mark.textContent !== m) mark.textContent = m;
      const st = el.querySelector<HTMLElement>('[data-stepstatus]')!;
      // "done" is stale when steps were added after the order finished (and before the next tick).
      const t = state === 'current' && w.auto.stepStatus !== 'done' ? w.auto.stepStatus : '';
      if (st.textContent !== t) st.textContent = t;
    }
    // Highlight the rule the selected unit is following.
    const sel = g.selected();
    const followed = new Set(sel.map((e) => e.intent).filter(Boolean) as string[]);
    for (const el of this.el.querySelectorAll<HTMLElement>('.rule[data-key]'))
      el.classList.toggle('mine', followed.has(el.dataset.key!));
  }

  // ---- Paths ----------------------------------------------------------------------------

  private resolve(path: string): Ref | undefined {
    const p = this.game.program;
    const [t, a, b, c] = path.split('|');
    if (t === 'C' || t === 'A' || t === 'R') {
      const scope = a as ScopeId;
      const rules = p.rules[scope];
      const rule = rules?.[Number(b)];
      if (!rule) return undefined;
      if (t === 'A') return { role: 'act', scope, get: () => rule.act, set: (x) => (rule.act = x as Rule['act']) };
      if (t === 'C') {
        const i = Number(c);
        return {
          role: 'cond',
          scope,
          get: () => rule.conds[i] as Block,
          set: (x) => (rule.conds[i] = x as Condition),
          remove: () => rule.conds.splice(i, 1),
        };
      }
      return { role: 'act', scope, get: () => rule as unknown as Block, set: () => {} };
    }
    if (t === 'S' || t === 'W') {
      const i = Number(a);
      const step = p.order[i];
      if (!step) return undefined;
      if (t === 'W' && step.kind === 'wait')
        return { role: 'cond', scope: 'base', get: () => step.cond as Block, set: (x) => (step.cond = x as Condition) };
      return {
        role: 'step',
        scope: 'base',
        get: () => step as unknown as Block,
        set: (x) => (p.order[i] = { ...(x as Step), id: step.id }),
        remove: () => p.order.splice(i, 1),
      };
    }
    return undefined;
  }

  private listOf(path: string): { list: unknown[]; i: number } | undefined {
    const [t, a, b] = path.split('|');
    if (t === 'R') {
      const list = this.game.program.rules[a as ScopeId];
      return list ? { list, i: Number(b) } : undefined;
    }
    if (t === 'S') return { list: this.game.program.order, i: Number(a) };
    return undefined;
  }

  // ---- Events -----------------------------------------------------------------------------

  private onClick(e: MouseEvent): void {
    const g = this.game;
    const t = e.target as HTMLElement;
    if (this.modal.contains(t)) return this.onModalClick(t);

    const cmd = t.closest<HTMLElement>('[data-cmd]')?.dataset.cmd;
    if (cmd) return this.onCommand(cmd);

    const scopeBtn = t.closest<HTMLElement>('[data-scope]');
    if (scopeBtn) {
      g.scope = scopeBtn.dataset.scope as ScopeId;
      this.closePop();
      g.programVersion++;
      return;
    }

    const chip = t.closest<HTMLElement>('.chip[data-path]');
    if (chip) return this.openChip(chip);

    const actEl = t.closest<HTMLElement>('[data-act]');
    if (!actEl) return;
    const act = actEl.dataset.act!;
    const path = actEl.dataset.path ?? '';
    const p = g.program;

    switch (act) {
      case 'toggle': {
        const ref = this.listOf(path);
        const rule = ref?.list[ref.i] as Rule | undefined;
        if (rule) rule.on = !rule.on;
        break;
      }
      case 'up':
      case 'down': {
        const ref = this.listOf(path);
        if (!ref) return;
        const j = ref.i + (act === 'up' ? -1 : 1);
        if (j < 0 || j >= ref.list.length) return;
        [ref.list[ref.i], ref.list[j]] = [ref.list[j], ref.list[ref.i]];
        if (path.startsWith('S')) this.fixStepPointer(ref.i, j);
        break;
      }
      case 'del': {
        const ref = this.listOf(path);
        if (!ref) return;
        const [removed] = ref.list.splice(ref.i, 1) as { id?: string }[];
        this.resumeIfNew(removed?.id);
        if (path.startsWith('S') && ref.i < g.world.auto.step) g.world.auto.step--;
        break;
      }
      case 'addcond': {
        const ref = this.listOf(path);
        const rule = ref?.list[ref.i] as Rule | undefined;
        if (!ref || !rule) return;
        const scope = path.split('|')[1] as ScopeId;
        rule.conds.push(schemasFor('cond', scope)[0].make(scope) as Condition);
        this.after();
        // Open the new condition's kind menu straight away.
        const chip = this.body.querySelector<HTMLElement>(`.chip.head[data-path="C|${scope}|${ref.i}|${rule.conds.length - 1}"]`);
        if (chip) this.openChip(chip);
        return;
      }
      case 'addrule': {
        const scope = actEl.dataset.scopeArg as ScopeId;
        const sc = schemasFor('act', scope)[0];
        const rule = r([], sc.make(scope) as Rule['act']);
        (p.rules[scope] ??= []).push(rule);
        return this.addedNew(rule.id);
      }
      case 'suggest': {
        const scope = actEl.dataset.scopeArg as ScopeId;
        const added = SUGGEST[scope]?.() ?? [];
        (p.rules[scope] ??= []).push(...added);
        if (added.length) return this.addedNew(added[added.length - 1].id);
        break;
      }
      case 'addstep': {
        const sc = schemaOf('step', actEl.dataset.kind!)!;
        const step = { ...(sc.make('base') as Step), id: newId() };
        p.order.push(step);
        return this.addedNew(step.id);
      }
      case 'stepfor': {
        const step = stepFor(p, actEl.dataset.def as DefId);
        p.order.push(step);
        return this.addedNew(step.id);
      }
      case 'resume':
        g.resume();
        this.render();
        return;
      case 'layout':
        g.mode = g.mode.type === 'layout' ? { type: 'normal' } : { type: 'layout', def: 'barracks' };
        g.programVersion++;
        g.uiVersion++;
        return;
      case 'palette':
        g.mode = { type: 'layout', def: actEl.dataset.def as DefId | 'muster' };
        g.programVersion++;
        return;
      case 'layoutreset':
        p.layout = DEFAULT_LAYOUT();
        break;
      default:
        return;
    }
    this.after();
  }

  /** Keep the running build order pointing at the same step after a swap. */
  private fixStepPointer(i: number, j: number): void {
    const a = this.game.world.auto;
    if (a.step === i) a.step = j;
    else if (a.step === j) a.step = i;
  }

  private onCommand(cmd: string): void {
    const g = this.game;
    const now = performance.now();
    const confirm = (name: string) => {
      if (this.armed?.cmd === name && this.armed.until > now) {
        this.armed = null;
        return true;
      }
      this.armed = { cmd: name, until: now + 3000 };
      g.programVersion++;
      setTimeout(() => {
        if (this.armed?.cmd === name) {
          this.armed = null;
          g.programVersion++;
        }
      }, 3100);
      return false;
    };
    switch (cmd) {
      case 'close':
        g.programsOpen = false;
        g.uiVersion++;
        return;
      case 'starter':
        if (nodeCount(g.program) > 0 && !confirm('starter')) return;
        g.replaceProgram(starterProgram());
        g.notify('Starter program loaded');
        return;
      case 'clear':
        if (!confirm('clear')) return;
        g.replaceProgram(emptyProgram());
        g.notify('Program cleared');
        return;
      case 'json':
        this.openJson();
        return;
    }
  }

  /** Deleting the rule or step you just added (before resuming) undoes the pause too. */
  private resumeIfNew(id: string | undefined): void {
    if (!id || id !== this.newItemId) return;
    if (this.game.editPause && this.game.paused) this.game.resume();
    this.newItemId = null;
  }

  /** A rule or step was just added: pause so units don't act on its defaults, and point at it. */
  private addedNew(id: string): void {
    this.game.pauseForEdit();
    this.newItemId = id;
    this.after();
    this.body.querySelector('.editpause')?.scrollIntoView({ block: 'nearest' });
  }

  private after(): void {
    this.closePop();
    this.game.programChanged();
    this.version = this.game.programVersion;
    this.render();
  }

  // ---- Chip menus -----------------------------------------------------------------------------

  private openChip(chip: HTMLElement): void {
    const path = chip.dataset.path!;
    const fieldKey = chip.dataset.field;
    const anchor = `[data-path="${path}"]${fieldKey ? `[data-field="${fieldKey}"]` : '[data-head]'}`;
    if (this.popAnchor === anchor && !this.pop.hidden) return this.closePop();

    this.numberRef = null;
    this.menu = [];

    if (fieldKey === 'keep') {
      const def = path.slice(2) as DefId;
      const cur = findKeep(this.game.program, def)?.value ?? null;
      const scope = keepScope(def);
      const where = scope === 'base' ? 'Base rules' : `${scopeName(scope)} rules`;
      this.menu = [
        {
          label: isBuildingDef(def) ? `Place blueprints until you have this many (${where})` : `Train whenever you have fewer than this (${where})`,
          divider: true,
        },
        ...KEEP_OPTIONS(def).map((k) => ({
          label: k === null ? 'off' : k === 'always' ? 'always (no limit)' : `keep ${k}`,
          current: k === cur,
          run: () => setKeep(this.game.program, def, k),
        })),
      ];
    } else if (fieldKey === 'max') {
      const ref = this.listOf(path);
      const rule = ref?.list[ref.i] as Rule;
      this.menu = MAX_OPTIONS.map((m) => ({
        label: m == null ? 'all units' : `at most ${m}`,
        current: rule.max === m,
        run: () => (rule.max = m),
      }));
      this.menu.unshift({ label: 'How many units may follow this rule at once', divider: true });
    } else {
      const ref = this.resolve(path);
      if (!ref) return;
      const block = ref.get();
      const sc = schemaOf(ref.role, block.kind as string)!;
      if (fieldKey) {
        const field = sc.fields.find((f) => f.key === fieldKey)!;
        if (field.type === 'enum')
          this.menu = field.options(ref.scope).map((o) => ({
            label: o.label,
            current: o.v === block[field.key],
            run: () => ref.set({ ...block, [field.key]: o.v }),
          }));
        else this.numberRef = { ref, field };
      } else this.menu = this.kindMenu(ref, sc, block);
    }

    this.popAnchor = anchor;
    this.renderPop();
    this.pop.hidden = false;
    this.reposition();
    this.pop.querySelector<HTMLInputElement>('input')?.select();
  }

  private kindMenu(ref: Ref, sc: Schema, block: Block): MenuItem[] {
    const items: MenuItem[] = [];
    if (Array.isArray(sc.head)) {
      items.push(
        { label: sc.head[0], current: !block.not, run: () => ref.set({ ...block, not: false }) },
        { label: sc.head[1], current: !!block.not, run: () => ref.set({ ...block, not: true }) },
        { label: 'Change to', divider: true },
      );
    }
    for (const other of schemasFor(ref.role, ref.scope)) {
      if (other.kind === sc.kind && Array.isArray(sc.head)) continue;
      items.push({
        label: headText(other, {}) + (other.tokens.some((t) => typeof t !== 'string') ? ' …' : ''),
        help: other.help,
        current: other.kind === sc.kind,
        run: () => {
          if (other.kind === sc.kind) return;
          ref.set(other.make(ref.scope));
        },
      });
    }
    if (ref.remove) {
      const remove = ref.remove;
      items.push({ label: '', divider: true });
      items.push({
        label: ref.role === 'step' ? 'Remove step' : 'Remove condition',
        danger: true,
        run: () => {
          if (ref.role === 'step') this.resumeIfNew((block as { id?: string }).id);
          remove();
        },
      });
    }
    return items;
  }

  private renderPop(): void {
    if (this.numberRef) {
      const { ref, field } = this.numberRef;
      const v = ref.get()[field.key] as number;
      this.pop.innerHTML = `<div class="num">
        <button data-inc="-1">−</button>
        <input type="number" id="prog-num" value="${v}" min="${field.min}" max="${field.max}" step="${field.step}" />
        <button data-inc="1">+</button></div>
        ${field.fmt ? `<div class="fmt">${esc(field.fmt(v))}</div>` : ''}`;
      return;
    }
    this.pop.innerHTML = this.menu
      .map((m, i) =>
        m.divider
          ? m.label
            ? `<div class="sep">${esc(m.label)}</div>`
            : '<hr />'
          : `<button class="opt${m.current ? ' cur' : ''}${m.danger ? ' danger' : ''}" data-i="${i}">${esc(m.label)}${m.help ? `<small>${esc(m.help)}</small>` : ''}</button>`,
      )
      .join('');
  }

  private onPopClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const stepBtn = t.closest<HTMLElement>('[data-inc]');
    if (stepBtn && this.numberRef) {
      const { field } = this.numberRef;
      const input = this.pop.querySelector<HTMLInputElement>('input')!;
      this.setNumber(Number(input.value) + Number(stepBtn.dataset.inc) * field.step);
      return;
    }
    const opt = t.closest<HTMLElement>('[data-i]');
    if (!opt) return;
    this.menu[Number(opt.dataset.i)]?.run?.();
    this.after();
  }

  private onPopInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.type === 'number' && input.value !== '') this.setNumber(Number(input.value), false);
  }

  private setNumber(v: number, rerenderPop = true): void {
    if (!this.numberRef || !Number.isFinite(v)) return;
    const { ref, field } = this.numberRef;
    const clamped = Math.min(field.max, Math.max(field.min, Math.round(v / field.step) * field.step));
    ref.set({ ...ref.get(), [field.key]: clamped });
    this.game.programChanged();
    this.version = this.game.programVersion;
    this.render();
    if (rerenderPop) this.renderPop();
    else if (field.fmt) {
      const f = this.pop.querySelector('.fmt');
      if (f) f.textContent = field.fmt(clamped);
    }
  }

  private reposition(): void {
    if (!this.popAnchor) return;
    const chip = this.body.querySelector<HTMLElement>(this.popAnchor);
    if (!chip) return this.closePop();
    const host = this.el.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    const popW = Math.min(300, host.width - 24);
    let left = c.left - host.left;
    left = Math.max(12, Math.min(left, host.width - popW - 12));
    this.pop.style.width = `${popW}px`;
    this.pop.style.left = `${left}px`;
    const below = c.bottom - host.top + 4;
    const maxH = host.height - below - 12;
    if (maxH < 160) {
      this.pop.style.top = '';
      this.pop.style.bottom = `${host.bottom - c.top + 4}px`;
      this.pop.style.maxHeight = `${c.top - host.top - 16}px`;
    } else {
      this.pop.style.bottom = '';
      this.pop.style.top = `${below}px`;
      this.pop.style.maxHeight = `${maxH}px`;
    }
  }

  private closePop(): void {
    this.pop.hidden = true;
    this.popAnchor = null;
    this.numberRef = null;
  }

  // ---- JSON import / export --------------------------------------------------------------------

  private openJson(): void {
    this.closePop();
    this.modal.hidden = false;
    this.modal.innerHTML = `<div class="sheet-mini">
      <h4>Program JSON</h4>
      <p class="note">Copy it to save or share. Paste a program and Apply to load it.</p>
      <textarea id="prog-json" spellcheck="false">${esc(JSON.stringify(this.game.program, null, 2))}</textarea>
      <div class="adders"><button class="addrule" data-m="copy">Copy</button><button class="addrule" data-m="apply">Apply</button><button class="addrule" data-m="cancel">Close</button></div>
    </div>`;
  }

  private onModalClick(t: HTMLElement): void {
    const m = t.closest<HTMLElement>('[data-m]')?.dataset.m;
    const ta = this.modal.querySelector<HTMLTextAreaElement>('textarea');
    if (!m || !ta) {
      if (t === this.modal) this.modal.hidden = true;
      return;
    }
    if (m === 'cancel') this.modal.hidden = true;
    else if (m === 'copy') {
      navigator.clipboard?.writeText(ta.value).then(
        () => this.game.notify('Program copied'),
        () => {
          ta.select();
          this.game.notify('Press Ctrl+C to copy');
        },
      ) ?? ta.select();
    } else if (m === 'apply') {
      try {
        this.game.replaceProgram(sanitizeProgram(JSON.parse(ta.value)));
        this.modal.hidden = true;
        this.game.notify('Program loaded');
      } catch {
        this.game.notify('That is not valid JSON');
      }
    }
  }
}

function shortName(s: ScopeId): string {
  const short: Record<string, string> = {
    marine: 'Light',
    marauder: 'Heavy',
    barracks: 'Inf. Training',
    factory: 'Mech Factory',
  };
  return short[s] ?? scopeName(s);
}

/** The rule an entity is following, as a sentence (for the selection panel). */
export function followingText(game: Game, id: number): string | null {
  const e = game.world.get(id);
  if (!e?.intent) return null;
  if (e.intent === 'base#build') return 'Placing a building for the base';
  const [scope, rid] = e.intent.split('#') as [ScopeId, string];
  const list = game.program.rules[scope] ?? [];
  const i = list.findIndex((x) => x.id === rid);
  if (i < 0) return null;
  return `${scopeName(scope)} rule ${i + 1}: ${describeRule(list[i], scope)}`;
}

/** Which editor tab an entity belongs to. */
export function scopeOfEntity(defId: DefId): ScopeId {
  return ALL_SCOPES.includes(defId as ScopeId) ? (defId as ScopeId) : 'base';
}
