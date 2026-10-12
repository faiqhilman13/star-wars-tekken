# Animation refinement pass (v3) — brief for all animators

The user's feedback on v2: movements "still look rather clanky". They want more animation per movement,
so every fighter moves **elegant, fluid and fast at the same time**, with **no janky or wonky stuff,
like limbs not moving correctly**.

## Engine changes already in (lead)
- **Splines.** `clip.ts`: `io` (the default) is now a **C1 monotone cubic spline through the keys**, so
  motion flows through poses instead of stopping on every key.
  - Stops still happen on extremes: a channel that reverses at a key has zero velocity there.
  - Keys that should *stop* need `hold`, `out` or `snap` (these segments end at rest).
  - `lin` stays linear (use it for smear frames before a `snap`).
  - Because the curve passes *through* keys with momentum, **breakdown keys now shape arcs**. Add them
    so hand and blade paths curve instead of travelling in straight lines.
- **Transitions.** `Animator.ts` inertializes every clip change: the old pose's offset *and velocity*
  decay into the new clip over about `blend × 1.6 + 1` frames. No more frozen cross-fades. Hit
  reactions snap in during the hitstop freeze.
- **Foot planting.** Feet are planted in the world in the states idle, crouch, attack (grounded),
  throwing, land, intro, victory and parrySuccess.
  - When the body travels, or a pose moves a grounded foot more than about 0.075, the foot takes an
    automatic quick lifted step (3–7 f) to its new spot.
  - Authored lifts (`fy`/`by` > 0.025) are followed exactly.
  - So **author real steps**: lift the foot when it moves. Auto-steps are a safety net, not the design.
- **IK** (`FighterRig.ts`):
  - Soft IK: limbs ease into full extension, so no elbow or knee pop.
  - Elbow and knee poles no longer flip when a limb points along its hint.
  - Hand targets are pushed out of the torso volume (free hands and the sword hand). Still, don't
    author hands inside the body.
- **New optional clips** (`types.ts` `OptionalClipName`). The animator uses each one if your set provides it:
  - `light2`, `light3`: 2nd and 3rd chained lights. They use **the same frame data as `light`**
    (contact on light's first active frame) but must be a *different swing*. Think combo strings:
    e.g. high diagonal → reverse horizontal → rising cut. They chain from the previous light's recovery.
  - `crLight2`: chained crouch light (a different low cut).
  - `heavyChain`: heavy used as a combo ender (heavy frame data). Make it a big finisher variation.
  - `idleBreak`, `idleBreak2`: occasional idle flourishes (60–150 f), alternating after 7–12 s of
    idling. Examples: Kael twirls the hilt; Vexa tilts her head, then cracks the blade; Asha spins a
    shoto; Thane does a staff figure-8. They must start and end on `stance`.
  - `runStart`: about 8–10 f push-off into the run (lean in, first stride), then the gait takes over.
    It should end close to the run gait's base pose.
  - `crouchDown` (about 5 f) and `standUp` (about 6 f): transitions with a dip and settle.
    `crouchDown` ends on `crouch`; `standUp` ends on `stance`.
  - `landHeavy`: landing after a flip or running jump. Deeper absorb, a hand or blade touching down,
    rise. About 10 f; the sim's landing lag is 3 f, then it hands to neutral, and inertialization
    covers the rest.
  - `hitHigh2`, `hitBody2`: alternate reactions used on every other hit (mirror the head snap
    direction, different arm flail).

## Quality bar for this pass
1. **More keys per move.** Every attack needs:
   - anticipation (opposite direction),
   - 1–2 smear or breakdown frames,
   - a contact pose on the first active frame,
   - overshoot and follow-through,
   - a settle with *successive breaking*: hips lead; torso, then arm, then blade trail by 1–3 f; the
     blade whips through.
   - Typical light: 6–9 keys. Typical heavy: 10–14 keys.
2. **Fast but fluid.** Startups stay snappy (`snap`/`lin` into contact). Recoveries flow (spline `io`
   with breakdowns on arcs). Nothing should linger stiffly, and nothing should float.
3. **Footwork.** Weight transfers you can see:
   - the front foot steps (with a lift) before a lunge contact;
   - the rear heel lifts and the toe pivots (`bPitch`) in follow-through;
   - recovery steps back with a lift;
   - feet never slide while planted (the auto-step catches mistakes, but author it).
4. **Limbs read correctly.**
   - No elbows bending backward or sideways in weird ways (use `nElbow`/`fElbow` to steer).
   - No knees caving in (`fKnee`/`bKnee`).
   - No wrists bent past about 70° against the forearm. The blade should continue the forearm line in
     slashes, or sit perpendicular in a natural grip.
   - No hands inside the torso or head.
   - No blade through your own head or torso on any frame, including the breakdowns the spline now
     generates (check every frame at `step=1`).
5. **Arcs.** Hand paths are arcs. If a hand goes from A to B, add a breakdown key off the straight
   line where the real arc passes.
6. **Variety and character.** Each character's rhythm stays distinct (see `animation-reference.md` §3):
   - Kael: compact and precise.
   - Vexa: heavy, with bursts and stillness.
   - Asha: acrobatic whirls.
   - Thane: flowing staff wheels.
7. **Keep all frame-data alignment.** Contact pose on the move's first active frame; specials and
   supers keep the timings in `roster.ts`.

## Tools
- **Pose lab.**
  - Command: `node scripts/pose-sheet.mjs --char <id> --clips light,light2,heavy --opp 1.8 --extra "step=1&cols=12&w=200&h=250"`.
  - It shows authored clips with splines (not runtime foot planting or inertialization).
  - Run it outside the sandbox with `PLAYWRIGHT_BROWSERS_PATH="C:/Users/User/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Local/ms-playwright"`.
- **In-game staged states.**
  - Command: `node scripts/state-shots.mjs --states "exchange.asha.thane,throw.asha.kael.18,super.thane.vexa" --live 0.5 --out <dir>`.
  - States: `title`, `select`, `active-play`, `exchange`, `clash`, `parry`, `grip`, `lightning`, `staff`,
    `leap`, `super`, `ko`, `throw` (optional 4th part = frame), `pause`, `result`.
  - Use `.char.char` suffixes to pick fighters.
- **Motion review** (runtime: inertialization, foot planting, springs).
  - Record with `node scripts/record-motion.mjs --out <dir>/m.webm --seconds 12 --chars asha,thane`.
  - Then tile 30 fps frames: `ffmpeg -ss 7 -i m.webm -vf "fps=30,crop=760:420:260:240,scale=330:-1,tile=8x6" -frames:v 1 sheet.png`. ffmpeg is on PATH.
  - Look for pops, jitter, sliding feet and limb flips.
- **Read every image** you produce.

## Concurrency
- A model worker is rebuilding the bodies (smooth skinned meshes, real hands, boots and cloth). The look
  will change under you; that's expected.
  - Do not edit `src/render/rig/*`, `characters.ts` or `geo.ts`.
  - The joint hierarchy and dims are not changing.
- The lead owns:
  - `shared.ts`, `Animator.ts`, `clip.ts`, `gait.ts`, `springs.ts` and `types.ts`;
  - `kael.ts` and `vexa.ts`;
  - the sim (`src/sim/*`) and `src/game/*`.
  Ask for changes in your report.
- Each animator owns only their character file.
