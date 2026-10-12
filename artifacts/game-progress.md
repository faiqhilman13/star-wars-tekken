# Saber Duel — Progress Note

## Intent and constraints
- User request: 1v1 lightsaber fighting game, Street Fighter-style gameplay; characters move left/right only on screen (2.5D side view), no 3D/depth movement.
- Scope bar: a good, complete fighting game (not an explicit premium/AAA request). Jump + crouch kept (in-plane, SF-style); no z movement anywhere.
- Asset keys: TRIPO/GEMINI/ELEVENLABS all MISSING (probe 2026-10-11) → procedural characters/stage, synthesized Web Audio.

## Decisions
- Custom deterministic 60 Hz frame sim (no physics engine), frame-data moves, 2D AABB hit/hurt/push boxes (`src/sim`).
- Modes: VS CPU (Easy/Normal/Hard), local 2 players, CPU-vs-CPU attract demo behind the title.
- Moves: light (L-L-H chain), heavy, crouch light (low), sweep (low, knockdown), air slash (overhead), throw (L+H, techable), Force Push (1 bar, deflectable by heavy), Saber Storm super (down+Force, 3 bars, freeze), forward/back dash (double tap), clash on blade-vs-blade.
- Characters: procedural rigs, pose = saber grip + blade angle + free hand + feet; two-bone IK; mirrored by scale.x.
- Post: bloom + vignette/grain/impact finish + output pass. Camera: SF-style framing, dolly by separation, wall clamp, super/KO focus.

## Workers (done)
- Arena worker → `src/render/Arena.ts` + `src/render/arena/*` (12 draw calls, ~40k tris, 9 textures).
- Audio worker → `src/audio/AudioEngine.ts` (all synthesized; limiter peak ≤ 0.974 under stress).

## Completed
- Sim + AI with headless regression (`dev/sim-smoke.ts`): 30 CPU-vs-CPU matches, side balance 16–14.
- Rendering: rigs, poses for every state, saber + trails, VFX, contact shadows, post.
- UI: HUD, announcer, title/pause/controls/results, touch controls, portrait band layout.
- QA: tests/visual.spec.ts (desktop + mobile touch), tests/bot-playtest.spec.ts (aggressive bot + idle loss/rematch), inspector manifest pass-1 (10 captures PASS), motion video + contact sheets.

## Fixed defects (this session)
- IK scratch-vector aliasing (legs/off-arm aimed wrong).
- Reversed smoothstep in particle/vignette shaders → NaN → bloom black screen during supers.
- Lying/KO pose, clash pose, skirt/cape slabs, over-red saber light, mobile framing, flip trail disc, dust opacity.
- Knockback direction simplification; menu confirm guard after screen change; Enter double activation.

- Independent review: 14 confirmed defects fixed (+3 plausible), regression probe 10/10.

## Status
- Done. Final verification pass-2 recorded in `artifacts/final-evidence.md` (build, preview, sim regression, smoke + bot playtests, 10 inspector captures, motion clip, evidence check).

## Possible next steps (not started)
- Second moveset / character select, training mode with frame data display, real-device mobile perf pass, online play.

## Running Playwright here
- `PLAYWRIGHT_BROWSERS_PATH=C:/Users/User/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Local/ms-playwright` and run outside the tool sandbox.

---

# v2 — animation & roster overhaul (2026-10-12)

## Intent
User feedback on v1: "not good enough in terms of animation diversity and character variety"; add a parry; "go crazy with the bodily animations … jumping, running, falling backwards, parrying, striking … use famous references (Star Wars, anime) … really nail the animations."

## Decisions
- 4 duelists with distinct forms and rhythms (reference sheet: `artifacts/animation-reference.md`):
  - KAEL: Soresu, blue, single blade; Force Push wave, Saber Storm.
  - VEXA: Djem So/Juyo, red, curved hilt; Force Grip, Force Lightning.
  - ASHA: Jar'Kai reverse grip + Ataru, two green blades; Ataru Leap, Twin Tempest.
  - THANE: saberstaff, yellow; Staff Throw boomerang, Whirlwind.
- Parry button (I / ; / pad A, LB, LT / touch): an 8f-ish window. Success brings a 15f freeze, a blue SF3 flash and meter; melee attackers stagger, waves reflect and staff throws bounce back.
- Run (double-tap forward), run-jump, ground bounce + slide, launch kinds (blowback/sweep/spin/throw/ko), hit reactions by contact height.
- Animation framework (`src/render/anim/*`):
  - ~48-channel poses; keyed clips with eases and torso/head lag.
  - Foot-planted gaits; spring secondaries frozen in hitstop.
  - Turnaround overlay; reactions time-warped to stun.
  - Select-screen showcases.
- Pose lab (`dev/pose-lab.html`, `scripts/pose-sheet.mjs`) renders frame-by-frame contact sheets with hitboxes, for review against the frame data.

## Workers
- Research → `artifacts/animation-reference.md` (done).
- Audio → new AudioEngine methods: parry, grip, lightning, staff, run, bounce, select (done).
- ASHA animator → `src/render/anim/asha.ts` (done; integrated; shared yaw fix applied).
- THANE animator → `src/render/anim/thane.ts` (done; integrated; super leap arc + robe flare added).

## Done (lead)
- Sim v2 (`src/sim/*`) + AI: parry, run, grip, staff, leap, bounce. sim-smoke: 16 matchups × 3, all resolve.
- Rig/costumes/weapons and animation framework.
- KAEL and VEXA sets, reviewed in pose-lab sheets:
  - Recoveries rerouted so blades never sweep through the opponent.
  - VEXA "Nosferatu" get-up; Force Lightning lunge; shared electrocuted victim clip.
- Game.ts rewrite:
  - Rig cache with mirror palettes; a trail per blade.
  - Character select (CPU sequential / versus simultaneous; mouse, keys and pad).
  - Effects and sound for parry, grip, lightning beam, staff boomerang, run, skid and bounce.
  - New test-hook states: select, parry, grip, lightning, staff, leap (plus `:char:char` suffixes).
- Tests and record-motion updated for the select flow. `scripts/state-shots.mjs` and `scripts/soak.mjs` added.

## Status
v2 complete. See `final-evidence.md`. Open items are listed under "Remaining limitations (v2)" there.


---

# v3 — models and motion refinement (2026-10-12)
User request: fix Asha's throw overlap; refine the models and animations (still clanky); more animation per movement, elegant/fluid/fast, no wonky limbs.

**Done:**
- **Asha's throw:** side-switch vault in the sim plus a new clip.
- **Models:** skinned bodies and costumes (model worker).
- **Motion engine** (lead):
  - spline interpolation, inertialized transitions, foot planting with auto-steps;
  - soft IK and stable poles, torso avoidance;
  - gait weight shift.
- **Variety clips:** light2/3, crLight2, heavyChain, idleBreak ×2, runStart, crouchDown/standUp, landHeavy, hitHigh2/hitBody2.
- **Refinement:** all four sets (lead: Kael/Vexa; workers: Asha/Thane). Shared hits and falls rebuilt.
- **QA:** anim-lint is clean.

**Verification:** all checks green; see `final-evidence.md` (v3).

---

# v4 — realistic characters (2026-10-12, in progress)
User request: realistic, detailed clothes and faces like Mount & Blade: Bannerlord; use Unity, Unreal or whatever suits. The user chose **Blender + MakeHuman (MPFB 2)**, keeping the Three.js game, and asked that the installed Blender skills be used.

**Decisions**
- **Engine:** no port. Blender produces GLB characters around the game's fixed skeleton; the runtime binds them to the existing joints, so animation, IK and foot planting are unchanged.
- **Downloads** (user-approved): MPFB 2.0.18 (43.8 MB, sha256 verified) and makehuman_system_assets_cc0.zip (267 MB, CC0), into `art/vendor/`.
- **Blender:** 5.2.1. The live GUI runs via the "MCP for Blender" add-on socket on :9876, driven by `tools/blender/bl.py`. The official Blender MCP tools can't reach it because the protocol differs. Headless builds use `--factory-startup` plus enabling the MPFB add-on.
- **Contract:** `art/CHARACTER_PIPELINE.md` (skeleton, frame, hands, cloth bones, materials, budgets, gates, milestones).

**Running jobs**
- **Blender artist** (background agent): M1 Kael body → M2 Kael costume → M3 Vexa/Asha/Thane. Owns `tools/blender`, `art/characters` and `public/models`.
- **Integration engineer** (the earlier model worker, resumed): GLB loader and binding, materials, preload and fallback, model-lab. Owns `src/render/rig` and loader modules.

**Next (lead):** review M1 and M2 against the gates, run in-game acceptance, then the full QA pass and evidence update.

---

# v5 — anime cel-shaded direction (2026-10-12, in progress)
The user rejected the realistic MakeHuman look ("like original RuneScape") and chose **anime cel-shaded: Guilty Gear Strive/Xrd × Star Wars: Visions**.
- **Retired:** MPFB/realistic (`art/characters/kael/exports/retired/`).
- **Downloads** (user-approved):
  - VRM add-on 4.10.2 (1.6 MB, sha256 verified);
  - nine VRoid CC0 sample VRMs from OpenGameArt (116 MB), in `art/vendor/vroid/`.
- **Docs:** `art/ANIME_DIRECTION.md` (pillars and cast design sheets) and the contract v5 header in `art/CHARACTER_PIPELINE.md`.
- **Lead:**
  - Guilty Gear-style limited animation: held poses on 2s and 3s per state; a new clip shows immediately.
  - Expression model (`FighterAnimator.expression`: blink, angry, shout, pain, smile, focus).
- **Running:**
  - artist: A1 Kael anime base → A2 Kael costume → A3 Thane; a second artist takes Vexa and Asha after A1;
  - runtime engineer: GG toon shader, inverted-hull outlines, toon procedural fallback, expression morphs.

**v5 status (end of session):** complete. All four anime GLB fighters are accepted and in-game; the toon renderer, outlines, expressions and limited animation are in; Kael is rebalanced; QA is green (see `final-evidence.md` v5). Restart the review server (`bash scripts/review-server.sh`) after adding or replacing a GLB.
