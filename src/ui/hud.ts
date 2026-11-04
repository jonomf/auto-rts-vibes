import { DEFS, MAX_QUEUE, costOf, type DefId } from '../sim/defs';
import { constructionProgress, isBuilding, isGatherer, isResource } from '../sim/actions';
import { ENEMY, PLAYER, type Entity } from '../sim/types';
import type { Game } from '../game';
import { SPEEDS } from '../game';
import { computeActions, ownControllable, type UiAction } from './actions';
import { icon } from './icons';
import { followingText, scopeOfEntity } from './editor';
import type { Posture, ScopeId } from '../automation/types';
import type { WheelMode } from '../input/input';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * DOM overlay: top bar (clock, time controls), stockpile list, selection panel,
 * command card, mode banner, toasts. Replaces the Unity HUD prefab.
 */
export class Hud {
  private actions: UiAction[] = [];
  private cache = new Map<HTMLElement, string>();
  private readonly el: {
    clock: HTMLElement;
    speed: HTMLElement;
    stock: HTMLElement;
    info: HTMLElement;
    card: HTMLElement;
    banner: HTMLElement;
    toast: HTMLElement;
    help: HTMLElement;
    objective: HTMLElement;
    posture: HTMLElement;
    handsOff: HTMLElement;
    programs: HTMLElement;
    wheelMode: HTMLElement;
    supply: HTMLElement;
  };

  constructor(root: HTMLElement, private readonly game: Game) {
    const q = (sel: string) => root.querySelector<HTMLElement>(sel)!;
    this.el = {
      clock: q('[data-clock]'),
      speed: q('[data-speed]'),
      stock: q('[data-stock]'),
      info: q('[data-info]'),
      card: q('[data-card]'),
      banner: q('[data-banner]'),
      toast: q('[data-toast]'),
      help: q('[data-help]'),
      objective: q('[data-objective]'),
      posture: q('[data-posture]'),
      handsOff: q('[data-handsoff]'),
      programs: q('[data-programs]'),
      wheelMode: q('[data-wheelmode]'),
      supply: q('[data-supply]'),
    };

    this.el.wheelMode.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-wm]');
      if (btn) game.setWheelMode(btn.dataset.wm as WheelMode);
    });

    this.el.posture.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-p]');
      if (btn) game.setPosture(btn.dataset.p as Posture);
    });
    this.el.handsOff.addEventListener('click', () => {
      game.handsOff = !game.handsOff;
      game.menu = 'root';
      if (game.mode.type !== 'layout') game.mode = { type: 'normal' };
      game.notify(game.handsOff ? 'Hands-off: the program runs everything' : 'Hands-on: your orders win until a unit finishes them');
    });
    this.el.programs.addEventListener('click', () => {
      game.programsOpen = !game.programsOpen;
      game.uiVersion++;
    });
    root.querySelector('[data-restart]')!.addEventListener('click', () => {
      game.restart();
      game.notify('Match restarted with your current program');
    });

    this.el.card.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!btn) return;
      const action = this.actions.find((a) => a.id === btn.dataset.action);
      if (!action) return;
      if (action.disabled) game.notify(action.disabled);
      else action.run();
    });

    this.el.info.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const cancel = t.closest<HTMLElement>('[data-cancel]');
      if (cancel) {
        const [id, index] = cancel.dataset.cancel!.split(':').map(Number);
        game.issue({ type: 'cancelTrain', buildingId: id, index });
        return;
      }
      const open = t.closest<HTMLElement>('[data-open-scope]');
      if (open) {
        game.openScope(open.dataset.openScope as ScopeId);
        return;
      }
      const pick = t.closest<HTMLElement>('[data-pick]');
      if (pick) game.select(game.selected().filter((s) => s.def === pick.dataset.pick).map((s) => s.id));
    });

    this.el.speed.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!btn) return;
      if (btn.dataset.pause !== undefined) game.togglePause();
      else if (btn.dataset.rate) game.setSpeed(Number(btn.dataset.rate));
    });

    this.el.stock.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-goto]');
      if (!row) return;
      const b = game.world.get(Number(row.dataset.goto));
      if (!b) return;
      game.select([b.id]);
      game.camera.x = b.x;
      game.camera.y = b.y;
    });

    root.querySelector('[data-help-toggle]')!.addEventListener('click', () => this.el.help.classList.toggle('open'));
    this.el.help.addEventListener('click', (e) => {
      if (e.target === this.el.help || (e.target as HTMLElement).closest('[data-help-close]'))
        this.el.help.classList.remove('open');
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        this.el.help.classList.toggle('open');
      }
    });
  }

  update(): void {
    const g = this.game;
    this.actions = computeActions(g);
    this.set(this.el.clock, clock(g.world.seconds));
    this.set(this.el.speed, this.speedHtml());
    this.set(this.el.stock, this.stockHtml());
    this.set(this.el.info, this.infoHtml());
    this.set(this.el.card, this.cardHtml());
    this.set(this.el.banner, this.bannerHtml());
    const toast = g.toast && g.time < g.toast.until ? g.toast.text : '';
    this.set(this.el.toast, toast ? esc(toast) : '');
    this.el.toast.classList.toggle('show', !!toast);
    this.el.banner.classList.toggle('show', this.bannerHtml() !== '');
    this.set(this.el.objective, this.objectiveHtml());
    const sup = g.world.supply(PLAYER);
    const full = sup.used >= sup.cap && sup.cap < 200;
    const over = sup.used > sup.cap;
    this.set(
      this.el.supply,
      `<span class="k">Supply</span> <b class="${over ? 'over' : full ? 'full' : ''}">${sup.used}/${sup.cap}</b>${
        over ? '<span class="tag">over cap: training 3× slower</span>' : full ? '<span class="tag">supply blocked</span>' : ''
      }`,
    );
    this.set(
      this.el.posture,
      (['economy', 'defense', 'offense'] as const)
        .map((p) => `<button data-p="${p}" class="${g.world.auto.posture === p ? 'on' : ''}">${p}</button>`)
        .join(''),
    );
    this.set(this.el.handsOff, g.handsOff ? '<span class="dot on"></span>Hands-off' : '<span class="dot"></span>Hands-on');
    this.el.programs.classList.toggle('on', g.programsOpen);
    this.set(
      this.el.wheelMode,
      (
        [
          ['auto', 'Auto-detect'],
          ['pan', 'Always pan'],
          ['zoom', 'Always zoom'],
        ] as const
      )
        .map(([v, label]) => `<button data-wm="${v}" class="${g.wheelMode === v ? 'on' : ''}">${label}</button>`)
        .join(''),
    );
  }

  private objectiveHtml(): string {
    const g = this.game;
    const left = g.targetsLeft();
    const best = g.best !== null ? ` · best ${clock(g.best)}` : '';
    if (g.won !== null) return `<span class="won">Cleared in ${clock(g.won)}</span>${best}`;
    return `Targets ${g.targetsTotal - left}/${g.targetsTotal}${best}`;
  }

  private set(el: HTMLElement, html: string): void {
    if (this.cache.get(el) === html) return;
    this.cache.set(el, html);
    el.innerHTML = html;
  }

  // ---- Top bar --------------------------------------------------------------------

  private speedHtml(): string {
    const g = this.game;
    const pause = `<button data-pause class="${g.paused ? 'on' : ''}" title="Pause (Space)">${g.paused ? '▶' : '❚❚'}</button>`;
    const rates = SPEEDS.map(
      (s) =>
        `<button data-rate="${s}" class="${!g.paused && g.speed === s ? 'on' : ''}" title="Speed (− / +)">${s}×</button>`,
    ).join('');
    return pause + rates;
  }

  /** Every building's own stockpile -- there is no global bank. */
  private stockHtml(): string {
    const g = this.game;
    // Only buildings that keep a stockpile (plus blueprints still being paid for).
    const own = g.world.list(
      (e) => ownControllable(e) && isBuilding(e) && (!e.complete || !!DEFS[e.def].trains || !!DEFS[e.def].addons),
    );
    const rows = own.map((b) => {
      const sel = g.selection.has(b.id) ? ' sel' : '';
      const name = DEFS[b.def].name;
      if (!b.complete) {
        const pct = Math.round(constructionProgress(b) * 100);
        return `<button class="row blueprint${sel}" data-goto="${b.id}">${icon(b.def)}<span class="name">${esc(name)}</span><span class="bar"><i style="width:${pct}%"></i></span><span class="num">${pct}%</span></button>`;
      }
      const q = b.queue.length ? `<span class="q">${b.queue.length}▸</span>` : '';
      return `<button class="row${sel}" data-goto="${b.id}">${icon(b.def)}<span class="name">${esc(name)}</span>${q}<span class="num m">${b.stock.minerals}</span><span class="num g">${b.stock.gas}</span></button>`;
    });
    const gatherers = g.world.list((e) => e.team === PLAYER && isGatherer(e));
    const idle = gatherers.filter((e) => e.order.type === 'idle').length;
    const army = g.world.list((e) => ownControllable(e) && !!DEFS[e.def].attack).length;
    return `<div class="head"><span>Stockpiles</span><span class="legend"><b class="m">min</b><b class="g">gas</b></span></div>${rows.join('')}
      <div class="foot"><span>${gatherers.length} SCVs${idle ? ` · <em>${idle} idle</em>` : ''}</span><span>${army} army</span></div>`;
  }

  // ---- Selection panel -----------------------------------------------------------------

  private infoHtml(): string {
    const sel = this.game.selected();
    if (sel.length === 0) return this.emptyInfo();
    if (sel.length === 1) return this.singleInfo(sel[0]);
    const groups = new Map<DefId, Entity[]>();
    for (const e of sel) groups.set(e.def, [...(groups.get(e.def) ?? []), e]);
    const tiles = [...groups].map(
      ([def, list]) =>
        `<button class="tile" data-pick="${def}" title="Select only ${esc(DEFS[def].name)}">${icon(def)}<span>${list.length}× ${esc(DEFS[def].name)}</span></button>`,
    );
    return `<div class="title">${sel.length} selected</div><div class="tiles">${tiles.join('')}</div>`;
  }

  private emptyInfo(): string {
    if (this.game.handsOff)
      return `<div class="title muted">Nothing selected</div>
      <ul class="hints">
        <li>Your units only do what the program says. Open it with <kbd>P</kbd> and give your SCVs a rule</li>
        <li>Or click <b>Load starter</b> in the editor for a complete program, then improve it</li>
        <li>Destroy every target on the right; the clock is your score · <kbd>?</kbd> for help</li>
      </ul>`;
    return `<div class="title muted">Nothing selected</div>
      <ul class="hints">
        <li>Hands-on: <kbd>Drag</kbd> to select, <kbd>Right-click</kbd> minerals, gas, enemies or ground</li>
        <li>SCVs deliver to the nearest Command Center, or <kbd>Right-click</kbd> a building to feed its stockpile</li>
        <li><kbd>B</kbd> to build · your orders win until the unit finishes, then the program takes over</li>
      </ul>`;
  }

  private singleInfo(e: Entity): string {
    const g = this.game;
    const d = DEFS[e.def];
    const owner = d.inert ? 'Target dummy' : e.team === PLAYER ? 'Yours' : e.team === ENEMY ? 'Enemy' : 'Resource';
    let html = `<div class="title">${icon(e.def)}<span>${esc(d.name)}</span><span class="tag">${owner}</span></div>`;

    if (isResource(e)) {
      const full = d.resource!.amount;
      html += meter('Remaining', e.remaining, full, d.resource!.type === 'minerals' ? 'm' : 'g');
      html += `<div class="line muted">${d.resource!.pieceSize} per trip</div>`;
      return html;
    }

    html += meter('HP', Math.ceil(e.hp), d.hp, 'hp');

    if (isBuilding(e)) {
      if (!e.complete) {
        const c = costOf(e.def);
        html += `<div class="line">Blueprint · gatherers deliver resources here to build it</div>`;
        if (c.minerals) html += meter('Minerals', c.minerals + Math.min(0, e.stock.minerals), c.minerals, 'm');
        if (c.gas) html += meter('Gas', c.gas + Math.min(0, e.stock.gas), c.gas, 'g');
        const feeding = g.world.list((u) => u.team === e.team && u.depositId === e.id).length;
        html += `<div class="line muted">${feeding} gatherer${feeding === 1 ? '' : 's'} delivering</div>`;
        return html;
      }
      if (d.inert) return html;
      html += `<div class="stockline"><span class="num m">${e.stock.minerals}</span> minerals <span class="num g">${e.stock.gas}</span> gas <span class="muted">in this building</span></div>`;
      if (d.addons)
        html += `<div class="line muted">Add-on: ${e.addon ? `<b>${DEFS[e.addon].name}</b>${e.addon === 'reactor' ? ' (trains two at once)' : ' (unlocks advanced units)'}` : 'none'}</div>`;
      if (d.supplyProvided) html += `<div class="line muted">Provides ${d.supplyProvided} supply</div>`;
      if (d.trains?.length) {
        const slots: string[] = [];
        for (let i = 0; i < MAX_QUEUE; i++) {
          const item = e.queue[i];
          if (!item) {
            slots.push('<span class="slot empty"></span>');
            continue;
          }
          const t = i === 0 ? item.elapsed / (DEFS[item.def].buildTime ?? 1) : 0;
          slots.push(
            `<button class="slot" data-cancel="${e.id}:${i}" title="Cancel ${esc(DEFS[item.def].name)} (refund)">${icon(item.def)}<i style="width:${Math.round(t * 100)}%"></i></button>`,
          );
        }
        html += `<div class="queue">${slots.join('')}</div>`;
        const n = g.program.rules[e.def as ScopeId]?.length ?? 0;
        html += g.handsOff
          ? `<button class="line rule-ref${n ? '' : ' none'}" data-open-scope="${e.def}">${n ? `${n} training rule${n === 1 ? '' : 's'}` : 'No training rules'} · edit ${esc(d.name)} rules</button>`
          : `<div class="line muted">${e.rally ? 'Rally set · ' : ''}Right-click to set rally point</div>`;
      }
      return html;
    }

    // Units.
    html += `<div class="line">${esc(orderText(g, e))}${e.manual ? ' <span class="tag">your order</span>' : ''}</div>`;
    if (e.team === PLAYER && !d.inert) {
      const follow = followingText(g, e.id);
      const scope = scopeOfEntity(e.def);
      html += follow
        ? `<button class="line rule-ref" data-open-scope="${follow.startsWith('Army') ? 'army' : scope}">${esc(follow)}</button>`
        : `<button class="line rule-ref none" data-open-scope="${scope}">No rule applies · edit ${esc(d.name)} rules</button>`;
    }
    if (isGatherer(e)) {
      const dep = g.world.get(e.depositId);
      const cargo = e.cargo ? `Carrying ${e.cargo.amount} ${e.cargo.type}` : 'Empty-handed';
      html += `<div class="line muted">${cargo}${dep ? ` · delivers to ${esc(DEFS[dep.def].name)}` : ''}</div>`;
    }
    html += `<div class="line muted">${attrLine(e)}</div>`;
    const atk = (e.sieged && d.siege) || d.attack;
    if (atk) html += `<div class="line muted">${weaponLine(atk)}${e.sieged ? ' · sieged' : ''}</div>`;
    if (d.siege && !e.sieged) html += `<div class="line muted">Siege mode: ${weaponLine(d.siege)}</div>`;
    if (d.heal) html += `<div class="line muted">Heals bio units ${d.heal.rate} HP/s within ${d.heal.range}</div>`;
    const status = [e.stimmed > 0 && `stimmed ${e.stimmed.toFixed(0)}s`, e.slowed > 0 && 'slowed', e.deploying > 0 && (e.sieged ? 'packing up' : 'sieging')].filter(Boolean);
    if (status.length) html += `<div class="line"><span class="tag">${status.join(' · ')}</span></div>`;
    return html;
  }

  // ---- Command card ---------------------------------------------------------------

  private cardHtml(): string {
    if (this.actions.length === 0) return '';
    return this.actions
      .map(
        (a) => `<button class="cmd${a.disabled ? ' off' : ''}${a.active ? ' active' : ''}" data-action="${a.id}" title="${esc(a.disabled ?? a.tooltip ?? a.label)}">
          ${a.hotkey ? `<kbd>${esc(a.hotkey)}</kbd>` : ''}${icon(a.icon)}<span class="lbl">${esc(a.label)}</span>${a.detail ? `<span class="detail">${esc(a.detail)}</span>` : ''}
        </button>`,
      )
      .join('');
  }

  private bannerHtml(): string {
    const g = this.game;
    const m = g.mode;
    if (m.type === 'place')
      return `Place <b>${esc(DEFS[m.def].name)}</b> · click to place · <kbd>Shift</kbd> to place several · right-click to cancel`;
    if (m.type === 'move') return 'Move · click a point or a target · right-click to cancel';
    if (m.type === 'attack') return 'Attack · click an enemy, or ground to attack-move · right-click to cancel';
    if (m.type === 'layout')
      return `Layout · click to place a <b>${m.def === 'muster' ? 'muster point' : esc(DEFS[m.def].name)}</b> slot · right-click a slot to remove · <kbd>Esc</kbd> when done`;
    if (g.paused) return 'Paused · <kbd>Space</kbd> to resume';
    if (g.won !== null && g.world.seconds - g.won < 8)
      return `All targets destroyed in <b>${clock(g.won)}</b> · <strong>Restart</strong> to race your program again`;
    return '';
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function attrLine(e: Entity): string {
  const d = DEFS[e.def];
  const parts = [(d.tags ?? []).filter((t) => t !== 'structure').map(cap).join(' · '), `armor ${d.armor ?? 0}`];
  if (d.supply) parts.push(`${d.supply} supply`);
  if (d.flying) parts.push('flying');
  return parts.filter(Boolean).join(' · ');
}

function weaponLine(a: NonNullable<(typeof DEFS)[keyof typeof DEFS]['attack']>): string {
  const targets = a.hitsAir && a.hitsGround ? 'ground + air' : a.hitsAir ? 'air only' : 'ground only';
  const dmg = `${a.damage}${a.hits && a.hits > 1 ? `×${a.hits}` : ''}${a.bonus ? ` (+${a.bonus.damage} vs ${a.bonus.vs})` : ''}`;
  const extra = [a.splash && 'splash', a.slow && 'slows', a.minRange && `min range ${a.minRange}`, a.suicide && 'explodes'].filter(Boolean);
  return `${dmg} dmg · range ${a.range} · every ${a.cooldown}s · ${targets}${extra.length ? ` · ${extra.join(' · ')}` : ''}`;
}

function meter(label: string, value: number, max: number, kind: 'm' | 'g' | 'hp'): string {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return `<div class="meter ${kind}"><span class="k">${label}</span><span class="bar"><i style="width:${pct}%"></i></span><span class="num">${value}/${max}</span></div>`;
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function orderText(g: Game, e: Entity): string {
  const o = e.order;
  const name = (id: number | null) => {
    const t = g.world.get(id);
    return t ? DEFS[t.def].name : '?';
  };
  switch (o.type) {
    case 'idle':
      return 'Idle';
    case 'move':
      return 'Moving';
    case 'follow':
      return `Moving to ${name(o.targetId)}`;
    case 'attack':
      return `Attacking ${name(o.targetId)}`;
    case 'attackMove':
      return o.engagedId != null && g.world.get(o.engagedId) ? `Engaging ${name(o.engagedId)}` : 'Attack-moving';
    case 'build':
      return `Going to build ${DEFS[o.def].name}`;
    case 'haul':
      return o.phase === 'toFrom'
        ? `Fetching ${o.res} from ${name(o.fromId)}`
        : `Hauling ${o.res} to ${name(o.toId)}`;
    case 'gather': {
      const src = g.world.get(e.sourceId);
      const type = src ? DEFS[src.def].resource!.type : 'resources';
      if (o.phase === 'toSource') return `Heading to ${type}`;
      if (o.phase === 'harvesting') return `Harvesting ${type}`;
      return `Delivering to ${name(e.depositId)}`;
    }
  }
}
