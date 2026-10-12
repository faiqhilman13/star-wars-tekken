# Saber Duel

A 1v1 lightsaber fighting game in the style of Street Fighter, built with Three.js. Fighters move only left and right (plus jumping and crouching) on a single fight plane, rendered in 3D.

## Run

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5188. For a production build, run `npm run build`, then `npm run preview` (http://127.0.0.1:4188).

## Modes

- **VS CPU:** pick your duelist, then your opponent. Choose Easy, Normal or Hard on the title screen.
- **2 Players:** same keyboard, or two gamepads. Both players pick at once on the select screen.
- The title screen plays a CPU-vs-CPU demo with random matchups.

Best of three rounds, 99-second timer. A mirror match gives Player 2 an alternate palette.

## The duelists

| | Style | Special (1 bar) | Super (3 bars) |
| --- | --- | --- | --- |
| **KAEL** (blue) | Soresu guardian: compact, precise, flips | Force Push (a wave that travels) | Saber Storm: a five-hit lunge |
| **VEXA** (red) | Djem So / Juyo marauder: heavy, stomping, never flips | Force Grip (a command grab: lift, choke, hurl) | Force Lightning: a beam from both hands |
| **ASHA** (green ×2) | Jar'Kai reverse grip + Ataru acrobatics | Ataru Leap (a flipping overhead) | Twin Tempest: a cross-through dash |
| **THANE** (yellow) | Saberstaff temple warden | Staff Throw (a boomerang that returns) | Whirlwind: a spinning advance, then a slam |

## Controls

| Action | Player 1 | Player 2 |
| --- | --- | --- |
| Walk / run (double-tap forward) / backdash (double-tap back) | A / D | ← / → |
| Jump (with a direction for forward/back; run + jump = running leap) | W | ↑ |
| Crouch | S | ↓ |
| Light slash | J | , (or Numpad 1) |
| Heavy slash | K | . (or Numpad 2) |
| Special (1 bar) | L | / (or Numpad 3) |
| Parry | I | ; (or Numpad 0) |
| Throw | J + K | , + . |
| Super (3 bars) | S + L | ↓ + / |
| Pause | Esc / P | Esc / P |
| Mute | M | M |

On the select screen, use left/right and Light to pick, and Heavy (or Backspace) to go back.

In VS CPU mode, Player 1 can use either keyboard layout. On a gamepad:

- Move with the stick or d-pad.
- X is light, Y is heavy.
- B, RB or RT is the special.
- A, LB or LT is parry.
- Start pauses.

On phones, a touch stick appears with SLASH / HEAVY / FORCE / GRAB / PARRY buttons.

## Fighting system

- **Blocking:** hold away from your opponent. Crouch-block lows (crouch slash, sweep) and stand-block jump-in slashes (overheads). Blocked hits deal small chip damage.
- **Parry:** tap Parry just before a hit lands (about 8 frames).
  - A successful parry freezes the clash, flashes you blue, gives you meter, and lets you act almost immediately.
  - A parried melee attacker staggers wide open.
  - Force waves are reflected.
  - A thrown staff bounces back to its owner.
  - A whiffed parry leaves you exposed.
- **Combos:** Light → Light → Heavy. Specials and supers cancel from Light or Heavy on hit or block. Damage scales down after the second hit.
- **Counter hits:** hit an opponent during their attack startup for bonus damage and stun.
- **Clash:** if both blades swing into each other, they lock and both fighters reset.
- **Throws:** beat blocking. Press Light + Heavy within 10 frames of being grabbed to break a throw. Force Grip cannot be broken.
- **Knockdowns:** hard hits launch fighters in different ways (blowback, sweep, spin, throw). They bounce off the deck once and slide.
- **Force meter:** built by attacking, taking hits, blocking, clashing and parrying. It carries between rounds.

## Animation

Every fighter has a hand-keyed animation set: stance, idle, walk, run, three jumps, landing, backdash, every attack, throws, special, super, parry set, hit reactions by height and strength, falls, bounce, get-up, intro and victory. The sets are built on a procedural IK rig. Choreography follows `artifacts/animation-reference.md`, which draws on film duels, lightsaber forms, and fighting-game and anime timing.

To inspect any clip frame by frame, with hitboxes and phase colours, use the pose lab:

```bash
node scripts/pose-sheet.mjs --char vexa --clips heavy,special --opp 1.8
```

## Project layout

- `src/sim/`: the deterministic 60 Hz fighting simulation. It contains no rendering code.
  - `Match` and `Fighter` run the fight.
  - Per-character frame data is in `roster.ts`.
  - The CPU is in `Ai.ts`.
- `src/render/anim/`: poses, clips, gaits, springs, the per-character sets (`kael.ts`, `vexa.ts`, `asha.ts`, `thane.ts`) and the `FighterAnimator`.
- `src/render/rig/`: the IK rig, costumes and weapons (single, dual, staff).
- `src/render/`: VFX, saber trails, camera, post-processing, and the Reactor Gantry stage.
- `src/audio/AudioEngine.ts`: all sound is synthesized live with Web Audio (no audio files).
- `src/ui/`, `index.html`, `src/styles.css`: HUD, character select and menus.
- `src/game/Game.ts`: the main loop. It runs the fixed-step simulation, sends events to effects, audio and UI, and installs the test hooks.

## Debug and tests

- Add `?debug` to the URL to draw hitboxes (red), grab boxes (orange), hurtboxes (green) and pushboxes (blue).
- Headless simulation regression: `npx rolldown dev/sim-smoke.ts --file <out>.mjs --platform node && node <out>.mjs`. The same command with `dev/balance.ts` gives damage by move for each matchup.
- Browser tests: `npx playwright test`. These are smoke tests with keyboard and touch input, plus bot playtests against the CPU.
- `node scripts/state-shots.mjs --states parry,grip,lightning`: screenshots of staged states.
- `node scripts/soak.mjs`: runs the attract demo and reports runtime errors.
- `node scripts/anim-lint.mjs [--chars asha]`: checks every frame of every clip for blades through the fighter's own head or body, over-stretched limbs, and limbs through the floor.
- `dev/model-lab.html`: close-up orbit views of the fighter models. `bash scripts/review-server.sh` starts a stable server with no hot reload on port 5190, for recordings.

## Character art pipeline

The fighters are anime cel-shaded GLBs in `public/models/`, built in Blender 5.2 from CC0 VRoid sample models.
- **Contract and art direction:** `art/CHARACTER_PIPELINE.md` and `art/ANIME_DIRECTION.md`.
- **Build scripts:** `tools/blender/` and `art/characters/<id>/build/`; see `tools/blender/README.md`.
- **Masters and review sheets:** `art/characters/<id>/`.

Third-party inputs are not in the repo. To rebuild the models, download them into `art/vendor/`:
- **VRoid CC0 models** (OpenGameArt "VRoid Studio CC0 models", https://opengameart.org/content/vroid-studio-cc0-models). Put each in `art/vendor/vroid/<name>/<name>.vrm`.
- **VRM add-on for Blender** (https://extensions.blender.org/add-ons/vrm/), installed into Blender.
