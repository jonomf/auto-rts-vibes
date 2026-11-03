# Auto-RTS

Starcraft, but very macro. You program your economy and army instead of micro-managing them.
This repo is the web-native port of the Unity prototype in `docs/rts`, with no engine and no runtime dependencies.

**Status: M1, the playable sandbox.** You get one base, three unit families, straight-line movement, and a field of inert target dummies.
M2 (automation blocks) is next; see [`.plan`](.plan).

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # simulation tests (Vitest)
npm run build      # typecheck + production build into dist/
```

## How it plays

- **Per-building stockpiles.** There is no global bank. Every building holds its own minerals and gas, and trains only from them.
- **Gathering.** Right-click minerals or gas with gatherers. They deliver to the nearest Home. Right-click another building to feed that building's stockpile instead.
- **Construction by delivery.** A gatherer places a blueprint (`B`). The blueprint is paid for by gatherers hauling resources to it, and it grows from 25% scale to full size as it fills. Nothing is deducted up front.
- **Tech.** Home → Infantry Training (Light/Heavy Infantry) → Mech Factory (Tank, needs gas) → Port (Ship, flying).
- **Combat.** Right-click to attack. `A` + click does attack-move. Idle units engage enemies in range.
- **Time.** `Space` pauses. `−` and `+` set 0.25×–4×. The sim runs on a fixed 20 Hz tick, independent of frame rate.

Press `?` in game for all controls.

## Layout

```
src/
  sim/              pure TypeScript simulation, no DOM, deterministic
    defs.ts         entity catalog: costs, build times, weapons (Unity: prefabs + CreateEntity assets)
    types.ts        Entity, Order, Command
    world.ts        World: entity store, fixed-tick step(), issue(command), hash()
    commands.ts     the only way to change what entities do
    actions.ts      shared rules: placement, training checks, delivery, rally, damage
    systems/        production, units (orders, gathering, combat), separation
    scenario.ts     the M1 sandbox map
  game.ts           client state: selection, modes, camera, time controls
  render/           Canvas 2D renderer + camera
  input/            mouse/keyboard → selection + commands
  ui/               HUD (DOM): stockpiles, selection panel, command card
tests/sim.test.ts   gameplay rules as tests
```

**Key design rule:** player input and (in M2) automation programs both go through the same `World.issue(command)`.
"No direct unit control" then just means turning the mouse's command source off.

## Ported from Unity

| Unity | Here |
|---|---|
| `Entity` / `Unit` / `Building` MonoBehaviours | plain `Entity` records in `World` |
| `GameAction` ScriptableObjects | `defs.ts` + `ui/actions.ts` (command card) |
| Coroutines (`WaitForSeconds`, `WaitForMovedTo`) | tick-based `Order` state machines |
| `UnitSystem` | `systems/units.ts` |
| `InputController` → `Interaction` → `Selection` → `HUD` | `input/input.ts` → `game.ts` → `ui/hud.ts` |
| `PlacementIndicator` | `place` mode + ghost in the renderer |

**Gather-loop bug fix (Unity `c2e443b`):** `Entity.SetTarget(Entity)` never cleared `TargetPosition`, so after one right-click move a gatherer "arrived" at every later target instantly and looped forever.
Here each `Order` carries exactly one target. A regression test covers it.
