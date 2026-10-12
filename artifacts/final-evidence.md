# Saber Duel — Final Evidence

> **v5 (2026-10-12): anime cel-shaded fighters.** This is the latest pass. The v3, v2 and v1 records follow below it.

## v5 result

The user's request: realistic or Bannerlord-grade models. The user rejected the realistic MakeHuman attempt ("like original RuneScape"), asked for "more SAUCE", and chose an **anime cel-shaded** direction (Guilty Gear Strive × Star Wars: Visions), built in Blender with the installed Blender skills.

### What shipped
- **Character models:** four GLB fighters in `public/models/`. Each is built from a CC0 VRoid base (OpenGameArt "VRoid Studio CC0 models") in Blender 5.2 with the VRM add-on. Each is fitted to the game's fixed 17-joint skeleton, so every existing animation, IK and foot-planting system drives them unchanged.

| Fighter | Look | Triangles | Materials | GLB |
|---|---|---|---|---|
| KAEL | anime Obi-Wan: cream tunic, tan tabards and obi, dark leather, brown hooded half-cloak with blue piping, painted beard, VRoid hair recoloured auburn | 28.5k | 8 | 2.0 MB |
| VEXA | hooded Sith: faceted mask with a red chevron visor, segmented cuirass, asymmetric pauldrons, crimson-lined split coat, tattered cape | 31.8k | 6 | 1.4 MB |
| ASHA | acrobat: teal halter and orange harness, split skirt with gold V hem, wraps and gloves, high ponytail with white streak, headband tails | 35.2k | 7 | 2.1 MB |
| THANE | Temple Guard: faceted ivory and gold mask, forked crest, ivory and gold robes over a dark under-robe, mantle, cape | 24.2k | 5 | 1.1 MB |

- **Face expressions:** `expr_blink/angry/shout/pain/smile/focus` on Kael and Asha, driven by the new animator expression model (blink rhythm, focus while guarding, anger and shouting on big swings, pain when hit, smile in victory).
- **Toon renderer** (`src/render/rig/toon.ts`, `characterModels.ts`, `modelBody.ts`):
  - a camera-relative character light, a hard two-step terminator into hand-picked warm shade colours, hard received shadows into the shade colour, and an inverse-ACES pre-compensation so colours land as authored;
  - rims: hair angel ring and metal glint; a narrow material rim; arena rims only on curved silhouettes, so a flat cape seen edge-on no longer turns orange;
  - inverted-hull ink outlines at 3.4–4.2 px at 1080p, from per-vertex width masks, in a darkened surface colour.
- **Limited animation** (Guilty Gear-style): poses are held on 2s and 3s per state; a new clip shows immediately. The bloom was tightened (0.85 → 0.5 strength, 0.42 → 0.26 radius) so blades no longer wash over bodies.
- **Procedural fallback:** the procedural bodies are also toon-shaded, as an automatic fallback if a GLB is missing.

### Pipeline (reproducible)
- **Contract:** `art/CHARACTER_PIPELINE.md`. Art direction: `art/ANIME_DIRECTION.md`.
- **Tools:** `tools/blender/` (`vroid_fit`, `vroid_finish`, `vroid_export`, `vroid_face`, `vroid_hair`, `toon_garment`, `kael_costume`, `thane_costume`, `sd_review`, `sd_glb_check`). Per-character builds are in `art/characters/<id>/build/` and documented in `tools/blender/README.md`.
- **Skills used:** text-to-blender, blender-skill-harmonizer, blender-image-to-3d (gated phases, `validate` / `roundtrip` / export), blender-modeling, blender-materials, blender-uv-texturing, blender-export, threejs-gltf-loading.
- **Gates per character** (all pass): `sd_glb_check` v5, `validate.py`, `roundtrip.py`, review sheets (body, face, hands on hilt, extreme poses) and 1080p in-game crops in `art/characters/<id>/review/`.

### Verification (v5)
| Check | Result |
|---|---|
| `tsc` + `npm run build` | Passed (1.11 MB JS; the GLBs are copied to `dist/models`) |
| `npx playwright test` | 4 passed, 2 skipped (desktop-only bots) |
| Inspector pass-5 | 21/21 PASS (hardware GPU), including the new matchup states |
| `check_evidence.py` | Passed: 23 artifacts |
| Perf (`scripts/perf-matchups.mjs`, all 10 pairings) | Worst case 70 draw calls desktop / 60 mobile, about 240 fps |
| Balance (8 seeds × 12 non-mirror pairings) | Wins out of 48: KAEL 24, VEXA 22, ASHA 29, THANE 21 (Kael was buffed slightly) |
| Headless sim | 48/48 finish, 0 floating |
| Anim lint | No new blade-through-body issues; only centimetre-level launch-frame contacts remain |
| Motion | [motion-kael-vexa.webm](pass-5/motion-kael-vexa.webm), [motion-asha-thane.webm](pass-5/motion-asha-thane.webm) |

### Licences
- **Bases:** VRoid CC0 samples.
- **Blender add-ons:** VRM add-on (GPL/MIT) and MPFB (used only in the retired v4 path).
- **Not used:** no assets from commercial games.

### Remaining limitations (v5)
- **Grip:** the female fists grip a roughly 17 mm channel against a 21.5 mm hilt (hidden by gloves).
- **Close-ups:** Asha has a ponytail-root crease in profile and a jagged glove edge at the knuckles.
- **Thane's super:** the robe bell-flares during the whirlwind spin. This is intentional.
- **Review pose sheets:** they don't drive skirt, cape or pad bones (the game does).
- **Retired assets:** the v4 realistic models are kept under `art/characters/kael/exports/retired/`.

---

# v3 record


## v3 result

The user's feedback on v2:
- Fix Asha's throw overlap.
- Really refine the character models and animations, which still looked "clanky".
- More animation per movement, so it's elegant, fluid and fast.
- No janky or wonky limbs.

### Asha's throw
It is now a real side-switch. The sim gained `throwVault`:
- the victim is held 0.86 in front of her;
- f11–18: she vaults over their head on a 1.05 arc and lands 1.05 behind them;
- the victim turns to face her;
- f24: she launches them back the way she came.

Her clip is a grapple, sink, handspring and tuck flip, then a blind reverse-grip double stab and a mule kick. Checked in-game frame by frame (`throw.asha.<opp>.<frame>` states): she clears the victim's head at the apex and there is no body overlap from the landing on.

### Models
Each of the four fighters is now one smooth-skinned body on the existing skeleton (`src/render/rig/body.ts`, `costumes.ts`):
- Continuous limbs with muscle tapering, and filler shapes so elbows and knees don't collapse when bent.
- Fists with fingers and a thumb wrapped round the hilt, and an open palm for Force gestures.
- Boots with heel and toe.
- Stylized faces (brow, nose, eyes, ears, beard, hair).
- Robes and coats on driven bones: they part around the knees, flare in spins and pool on the floor.
- Capes on 4-bone chains.
- Hit flash is now relative to the costume colour (no more white bodies). Parry and lightning flashes are flat tints.

**Draw calls:** desktop 50–68 (was 126–160); mobile 41–56 (was 79–100).

**Body + costume triangles:** about 19–26k per fighter.

### Motion engine (all fighters)
- **Splines.** Clips interpolate on C1 monotone cubic splines through the keys, so motion flows through poses; stops happen only on extremes or on `hold`/`out`/`snap` keys.
- **Inertialized transitions.** Every clip change carries the previous motion's offset *and velocity*, decaying on a quintic. No pops and no frozen cross-fades; hit reactions snap in during hitstop.
- **Foot planting.** Feet stay fixed on the deck and take quick automatic lifted steps when the body travels or a pose moves a grounded foot. No skating.
- **IK.**
  - Soft IK: limbs ease into full extension instead of snapping straight.
  - Flip-free elbow and knee poles.
  - Hand targets are pushed out of the torso volume.
- **Gaits.** Pelvis tilt, chest counter-roll and spine counter-rotation in walks and runs.
- **Blade lighting.** Blade lights dim near bodies, and blade glow and light are normalised by colour brightness.

### More animation per movement
- **Combo strings.** The 2nd and 3rd chained lights use different swings (`light2`, `light3`). There is a second crouching light (`crLight2`), and a heavy that ends a combo uses its own finisher (`heavyChain`).
- **Idle flourishes.** Two per character, alternating after 7–12 s of idling.
- **Transitions.** Run start, crouch down and stand up, and a heavier landing after flips and running jumps.
- **Hit reactions.** An alternate high and body reaction on every other hit.
- **Shared reactions rebuilt.** Every hit, the stagger and every fall gained keys and weight shifts with stepping feet, and falls now settle into the lying pose before touching down. The lying pose was reworked so the blade lies past the head.
- **Characters.** Kael and Vexa were refined by the lead; Asha and Thane by their animators (v3 second passes on every clip).

### Animation QA
`node scripts/anim-lint.mjs` sweeps every frame of every clip of all four fighters through the real rig. It checks for:
- a blade through the fighter's own head or torso;
- a hand or foot that can't reach its target;
- a limb through the floor;
- pops.

**Final run:** zero head or torso hits. Every remaining item is a few centimetres: launch-frame feet on falls (the body is airborne in the game), or deliberate fast spins flagged as pops.

### Verification run (v3)
| Check | Result |
|---|---|
| `tsc` + `npm run build` | Passed (1.01 MB JS, 276 kB gzipped; chunk-size warning only) |
| Headless sim | 48/48 matches finish, 0 floating |
| Balance (6 seeds × 12 pairings) | Wins out of 36: KAEL 18, VEXA 16, ASHA 20, THANE 18 |
| `npx playwright test` | 4 passed, 2 skipped (bots are desktop-only) |
| ↳ Aggressive bot | 2107 damage, won 2–0, softlock windows 3 (was 13) |
| ↳ Idle bot | Loses 0–2; rematch resets |
| Inspector pass-4 | 19/19 PASS on a hardware GPU, including the new `throw.asha.kael.24` and `chain.kael.vexa.5` states |
| `check_evidence.py` | Passed, 21 artifacts |
| Motion | [motion-kael-vexa.webm](pass-4/motion-kael-vexa.webm), [motion-asha-thane.webm](pass-4/motion-asha-thane.webm) |

### New tools
- `dev/anim-lint.html` and `scripts/anim-lint.mjs`: frame-by-frame animation QA.
- `dev/model-lab.html`: close-up orbit views of any joint.
- `scripts/review-server.sh`: a stable dev server with no hot reload, on port 5190, for recordings.
- New test-hook states:
  - `throw.<a>.<b>.<frame>`;
  - `chain.<a>.<b>.<frame>`.

### Remaining limitations (v3)
- **Fast staff wheels:** Thane's fast wheels and twirls still cross *in front of* the mask in side view for 1–3 frames, always 0.3 m or more nearer the camera.
- **Thane's running jump:** the staff passes behind his body for about 5 frames mid-twist.
- **Recordings:** Playwright's VP8 recordings smear bright blades. The PNG captures are the accurate reference.
- **Bundle size:** the main bundle is 1.0 MB (one chunk).

---

# v2 record


## v2 result

The user's feedback on v1: not enough animation diversity or character variety. They asked for a parry and for reference-grounded body animation that "really nails" jumps, runs, falls, parries and strikes.

### Roster
Four duelists, each with their own form, rhythm, frame data, special and super. The choreography reference is [animation-reference.md](animation-reference.md).

| | Form and references | Signature animation |
|---|---|---|
| KAEL (blue) | Soresu (Obi-Wan) | High guard with the palm pointed. Tuck front flip and layout back flip. Force Push. Saber Storm: a five-hit lunge ending in a Falling Avalanche. Back-roll get-up. |
| VEXA (red, curved hilt) | Djem So / Juyo (Vader, Kylo, Anakin) | Stomping walk, and a charge-run with the blade trailing low. Never flips. Falling Avalanche heavy (knee lift, tremble, stomp, blade buried). Choke-slam throw. Force Grip (lift, choke, hurl). Force Lightning (blade off, Palpatine lunge). "Nosferatu" get-up. |
| ASHA (green ×2) | Jar'Kai reverse grip + Ataru (Ahsoka, Yoda; Demon Slayer) | Bouncing idle, Naruto run, corkscrew and flip jumps. Three-point superhero landing. Ataru Leap (tuck flip into a double ice-pick). Twin Tempest cross-through. Kip-up get-up. |
| THANE (yellow staff) | Temple Guard / Maul / Inquisitor | Double-end windmill heavy and a Maul kick. Butterfly-twist run-jump. Staff Throw boomerang (a real spinning projectile, with his hands empty until he catches it). Whirlwind: five spins, a leap and a horse-stance slam. Breakdance get-up. |

### Systems added
- **Parry** (I / ; / pad A, LB or LT / touch PARRY):
  - Success brings a 15-frame freeze, a blue SF3-style flash and meter.
  - Melee attackers stagger, waves are reflected, and a staff throw bounces back.
- **Movement:** run (double-tap) with a skid stop, running jumps, and backdash.
- **Hits and falls:** reactions by contact height × strength (high, body, low, crouch, stagger). Launches are blowback, sweep, spin, throw or KO, with a ground bounce and slide.
- **Grip and lightning:** a Force Grip command grab, and a Force Lightning beam with a shared electrocuted reaction.
- **Select screen:** CPU picks are sequential; versus picks are simultaneous; works with mouse, keys and pad. The 3D previews play each duelist's intro (or a flourish when locked in), and a mirror match gives Player 2 an alternate palette.

### Animation framework
`src/render/anim/`:
- Poses of about 48 channels; keyed clips with eases and torso/head lag (successive breaking of joints).
- Foot-planted gaits (no foot skating).
- Springs frozen during hitstop.
- Reactions time-warped to the stun length.
- Turnaround overlay, and robe flare driven by spin speed.
- Hits, falls and get-ups shared between characters, with overrides per character.

Every contact pose was checked with the pose lab (`scripts/pose-sheet.mjs`, sheets in [pose-sheets/](pose-sheets/)), against the live hitbox on the first active frame.

### Verification run (v2)
| Check | Result |
|---|---|
| `tsc` + `npm run build` | Passed (924 kB JS, 248 kB gzipped; chunk-size warning only) |
| Headless sim (`dev/sim-smoke.ts`) | 16 matchups × 3: all 48 matches finish, 0 floating states. Every state and move is reached, including parry, grip, leap, staff catch and bounce. |
| Balance probe (`dev/balance.ts`, 6 seeds × 12 non-mirror pairings) | Wins: KAEL 19, VEXA 17, ASHA 16, THANE 20 (out of 36 matches each) |
| `npx playwright test` | 4 passed, 2 skipped (bots are desktop-only by design) |
| ↳ Visual smoke tests (desktop + mobile touch) | Pass through the select flow |
| ↳ Aggressive bot | 1990 damage, a round resolved, no errors |
| ↳ Idle bot | Loses 0–2; results screen; rematch resets |
| Inspector manifest pass-3 | 17/17 captures PASS on a hardware GPU, all within budget |
| ↳ Desktop draw calls | 140–166, about 90k triangles |
| ↳ Mobile draw calls | 86–102 (fighter shadow casting is off on low quality) |
| `check_evidence.py` | Passed: 19 artifacts confirmed |
| Motion | [motion-vexa-kael.webm](pass-3/motion-vexa-kael.webm), [motion-asha-thane.webm](pass-3/motion-asha-thane.webm), plus contact sheets in `pass-3/` |
| Attract soak (`scripts/soak.mjs`, 30 s) | No runtime errors |

### Defects found and fixed in v2 review
- **Blades sweeping the opponent:** recoveries (Kael heavy, Vexa light and heavy, grip and throw) swept the blade forward through the opponent. They now circle down and back.
- **Disappearing rig:** with the rig cache, swapping sides made a fighter's rig invisible. Visibility is now settled after both sides are assigned.
- **Flash washout:** whole-body hit flashes washed the models white. They are now short and subtle; the parry flash is blue and the lightning flicker is violet.
- **Blown-out pale costumes:** the bloom threshold was 0.8, so pale robes bloomed. It is now 1.0. Weapon lights are normalised by blade luminance (yellow and green were about 2.5× brighter than blue and red), and the staff light moved off the chest.
- **Floating victims:** the grip and lightning victims had generic poses. They now have dedicated choked and electrocuted clips.
- **Thane's leap:** the super's leap was faked in the pose. A sim arc was added for frames 46–50.
- **Dual blades flailing:** shared falls and reactions set blade pitch without yaw, so reverse-grip and dual blades flailed. Explicit yaws were added.
- **Mobile draw calls:** the mobile draw-call budget was exceeded (166/150). It is now 86–102.
- **Landscape select screen:** the cards hid the previews. A compact roster is used below 520 px of height, and touch prompts replace the keyboard hints.
- **Balance:** VEXA won 17 of 18 non-mirror matches (heavy reach). Her heavy and sweep reach and damage, and her grip range, were trimmed, and ASHA was buffed.

### Remaining limitations (v2)
- **Asha's throw:** the sim launches the victim forward, but her vault lands her behind them. The animation fakes it, and the bodies overlap for about 3 frames.
- **Foreshortening:** horizontal blade sweeps (Asha heavy and sweep, Thane sweep) foreshorten from the side camera and rely on the trails to read.
- **Thane's long robes** hide his legs during kicks; the kicks read through the boot and the robe flare.
- **Main bundle** is about 0.9 MB (one chunk).

---

# v1 record


Request: a 1v1 lightsaber fighting game with Street Fighter-style gameplay. Characters move only left and right on screen (2.5D side view), with no 3D or depth movement.

## Result

A complete browser fighting game built with Three.js, Vite and TypeScript, in `C:\Users\User\PROJECTS\saber-duel`.

- **Modes:** VS CPU (Easy, Normal, Hard), local 2 players (shared keyboard or two gamepads), and a CPU-vs-CPU demo playing behind the title screen.
- **Movement:** locked to the fight plane (z = 0). Fighters walk, dash/backdash (double-tap), jump forward, back or straight up (with a somersault), crouch, and can cross over each other.
- **Moves:** light (with a Light-Light-Heavy chain), heavy (also an anti-air, and cuts Force waves), crouch light (hits low), sweep (hits low, knocks down), air slash (overhead), throw (Light+Heavy, breakable), Force Push (projectile, 1 bar), and the Saber Storm super (down+Force, 3 bars, screen freeze, 5 hits).
- **Systems:** blade clash when attacks meet, counter hits, chip damage, corner pushback, combo scaling, best of three rounds, a 99-second timer, perfect rounds, double KO and draws, and a meter that carries between rounds.
- **Presentation:** procedurally modelled duelists (KAEL and VEXA) animated with IK, with sabers held in both hands. Glowing blades with smooth swing trails, hit sparks, a lightning crackle on clashes, contact shadows, and the Reactor Gantry stage. All audio is synthesized, with a fighting-game HUD, announcer, menus and touch controls.

The full design is in [design-brief.md](design-brief.md) (design brief, core-loop contract, stage plan), with decisions and continuity in [game-progress.md](game-progress.md). How to run it is in [README.md](../README.md).

## Skills and resources loaded

- **threejs-game-director:** SKILL.md and references/evidence-manifest.md, plus scripts/probe_asset_credentials.sh and scripts/check_evidence.py.
- **threejs-gameplay-systems:** SKILL.md, references/game-feel.md, genre-design.md and physics-engine-selection.md (custom collision chosen), plus scripts/create_threejs_game.py (scaffold).
- **threejs-aaa-graphics-builder:** SKILL.md, references/authoring-recipes.md, technical-art.md, and the shader-cookbook.md post-processing section. The arena worker also read shader-cookbook.md in full.
- **threejs-game-ui-designer:** SKILL.md and references/ui-patterns.md.
- **threejs-qa-release:** SKILL.md, references/release-checks.md, playtest-bot.md and visual-test-harness.md, plus scripts/inspect-threejs-canvas.mjs.
- **threejs-audio-generator:** SKILL.md and references/audio-workflows.md (read by the audio worker).
- **threejs-debug-profiler:** SKILL.md (reviewed at install time; no separate profiling pass was needed).

## Asset sourcing

The credential probe returned `TRIPO_API_KEY=MISSING`, `GEMINI_API_KEY=MISSING` and `ELEVENLABS_API_KEY=MISSING`. Everything was therefore built locally:

- **Characters:** procedural rigs.
- **Stage:** procedural geometry and canvas textures.
- **Audio:** synthesized with Web Audio.

No external services are called, and there are no keys in the code or the build.

## Verification (pass-2, final code revision)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck and production build | `npm run build` | Pass. JS 780.8 kB (210.4 kB gzip), CSS 18 kB. `base: './'` so it runs from any static host path. |
| Production preview | `npm run preview` → http://127.0.0.1:4188 | Boots to the title demo with no console errors; the dev-only debug handle is stripped. |
| Headless sim regression | `dev/sim-smoke.ts` | 30 Normal-vs-Normal CPU matches: P1 13 / P2 17 wins, average match 93 s; every move type occurs. |
| Review-defect regressions | scratchpad `probe/regress.ts` | 10/10 pass, including 112 mid-air clashes (none left floating) and a 40-match soak with 0 floating frames. |
| Smoke tests, real input | `npx playwright test tests/visual.spec.ts` | Desktop keyboard and mobile touch (stick plus SLASH button): move, attack, pause and resume pass, with no console or page errors. |
| Bot playtest, aggressive | `tests/bot-playtest.spec.ts` (seed 12345, Normal CPU) | 140 steps, 17,627 frames, 64.3 units travelled, 2,001 damage dealt, first damage at step 2, 2 rounds resolved (P1 won 2–0), 4/140 softlock windows (below threshold), no errors. |
| Bot playtest, idle (fail and retry) | same file, Hard CPU | First KO at 19.0 s; CPU wins 2–0; result screen shows "VEXA WINS"; Rematch restarts round 1 at full health; no errors. |
| Canvas captures | inspector `--manifest artifacts/evidence.json --seed 42` | 10/10 PASS on a hardware GPU (ANGLE / RTX 3080). |
| Evidence coverage | `check_evidence.py . --manifest artifacts/evidence.json` | 11 artifacts confirmed (run pass-2). |
| Motion | `scripts/record-motion.mjs` → [motion-desktop.webm](pass-2/motion-desktop.webm), [motion-sheet.png](pass-2/motion-sheet.png) | Reviewed: locomotion, jump-in somersaults, cross-ups with facing switches, crouch slashes, guards, hits, blade contact. |

### Captures (pass-2)

- **Desktop:** [title](pass-2/desktop-title.png) · [active play](pass-2/desktop-active-play.png) · [exchange with damage, meter and pips](pass-2/desktop-exchange.png) · [clash](pass-2/desktop-clash.png) · [super freeze](pass-2/desktop-super.png) · [KO with victory pose](pass-2/desktop-ko.png) · [pause](pass-2/desktop-pause.png) · [result](pass-2/desktop-result.png)
- **Mobile (390 px portrait):** [exchange with touch controls](pass-2/mobile-exchange.png) · [title](pass-2/mobile-title.png)

### Renderer budget (desktop exchange view)

| Metric | Actual | Budget | Status |
| --- | --- | --- | --- |
| Draw calls | 138 | 300 | Pass |
| Triangles | 90k | 750k | Pass |
| Geometries | 70 | 300 | Pass |
| Textures | 25 | 60 | Pass |

- **Shadows:** one shadow-casting light, with a 2048 map on desktop and 1024 on touch devices.
- **Post-processing:** bloom plus one finishing pass.
- **DPR cap:** 2 on desktop, 1.5 on touch devices.
- **Arena alone:** 12 draw calls and about 40k triangles.
- **Frame rate:** the headless bot run advanced about 170 frames per second at 1280×720. Mobile performance is not yet validated on real hardware.

### Physics and simulation

- Custom deterministic 60 Hz simulation, with no physics engine.
- Collision uses 2D AABB hit, hurt and push boxes.
- Hitstop freezes the simulation, while effects keep running in real time.
- All randomness uses a seeded RNG; the CPU uses its own seeded streams.

### Visual test harness decision

No pixel-diff baselines were added. The deterministic test hooks exist (`title`, `active-play`, `exchange`, `clash`, `super`, `ko`, `pause`, `controls`, `result`), so the inspector manifest covers each state per run. Pixel baselines would mostly fail on drifting embers, haze and saber flicker unless heavily masked.

## Defects found and fixed this session

1. **IK aliasing:** a scratch vector was reused for both output and working value, so legs and the off-hand arm aimed in garbage directions.
2. **Super freeze black screen:** reversed `smoothstep` edges in the particle and vignette shaders produced NaN pixels, which bloom spread across the frame.
3. **Visual fixes:** clash pose, lying/KO pose, skirt and cape slabs, over-red saber point light, phone framing, flip-trail disc, dust opacity, hit-flash strength.
4. **Independent review (14 confirmed):**
   - **High:** a mid-air clash, or a hit on the takeoff frame, left a fighter floating in a ground state.
   - **Round flow:** a throw still landed after time ran out; a buffered Force press fired after a KO.
   - **Moves and throws:** the super could be hit on its first frame; heavy after a chained light became a throw; throws couldn't be teched by pressing early from neutral.
   - **Feedback and input:** false "no meter" feedback; dash inputs weren't buffered; held keys fired attacks on resume; clicking outside the window didn't pause.
   - **CPU:** crouch-light → heavy combo plan couldn't come out; the wave deflect was mistimed.
   - **Test hook:** `result` left the match running.
   - **Also fixed (from the reviewer's plausible list):** CPU plans now resolve direction when emitted; CPU plans clear when the CPU is hit; Force waves are blocked by their travel direction.

## Remaining limitations

- Mobile performance hasn't been measured on a real phone; headless numbers come from a desktop GPU. Portrait mode works, but landscape is the better phone experience.
- There are two characters, each with one moveset. Both play the same; the difference is appearance only.
- Audio has been checked through the engine's debug state and the worker's offline level measurements (peak ≤ 0.974), not by a listening session in this pass.
- No online play.
