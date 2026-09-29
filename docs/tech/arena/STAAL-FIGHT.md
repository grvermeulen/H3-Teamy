# Staal vs. Trump (0.6.1)

## Summary

A one-minute, Street Fighter-style fight animation at `/arena/staal`, linked from the GTA H3
launcher card as "Bonus · arcadegevecht". Staal (the bald, grey-bearded man in red sunglasses from
the GTA H3 splash art) fights a Trump caricature on a sunset boardwalk: a parried "Je bent
ontslagen!", two combos (the second 21 hits), a super ("Staalkracht") with a slow-motion
finishing uppercut into the beach bar, and a well-deserved beer. It is a fixed choreography, not
a game: nobody plays it, it plays itself.

Everything is drawn on a 2D canvas from code (no sprites): a skeleton per fighter, keyframed
poses, particles, a parallax stage and the HUD. Sound is 25 ElevenLabs sound effects plus one
minute of ElevenLabs music, played through Web Audio.

## Where things live

- `src/app/arena/staal/page.tsx` — the route.
- `src/components/staalFight/StaalFight.tsx` — full-screen canvas (16:9, letterboxed), start /
  replay / mute / full-screen buttons, the poster frame. Audio is created on the first tap.
- `src/lib/staalFight/` — the engine:
  - `rig.ts` — bone lengths, stance, forward kinematics, two-bone IK for feet and reaches.
  - `moves.ts` — the move library: keyframed poses (jab, uppercut, sweep, tie whip, drink, …)
    and procedural ones (idle, walk, rush, dizzy).
  - `script.ts` — the script format and `ScriptBuilder`.
  - `choreography.ts` — the fight itself, beat by beat.
  - `timeline.ts` — `TimeWarp` (hit-stops freeze story time, slow motion stretches it), and
    what each fighter is doing at any story time (`fighterAt`), health, combos, super meter.
  - `effects.ts` — seeded particles, screen shake, flashes.
  - `scene.ts` — the camera and the frame: stage, fighters, effects, HUD and overlays.
  - `player.ts` — the loop: real time → story time, fires blows and cues, draws.
  - `audio.ts`, `clips.ts` — the clip table and the Web Audio mixer (a low-pass and a pitch drop
    in slow motion, a tape stop on the music at the finisher).
  - `draw/` — Staal, Trump, the stage, the HUD and the overlays (versus screen, banners, speech
    bubbles, super cut-in, letterbox, end card).
- `public/arena/fight/` — the clips and `CREDITS.md`.

## Changing the fight

Edit `choreography.ts`. Clips chain positions per fighter (a clip starts where that fighter's
previous clip ended); `hit()` adds a blow with its hit-stop and shake; cues add sounds, banners,
bubbles, camera moves and prop changes. `choreography.test.ts` guards the essentials: Staal wins
and Trump stays up until the slow-motion finisher, every blow visibly connects (the striking
fist or foot within 45 px of the other body), both fighters stay on stage and on their side,
the super meter is full when the super fires, the beer follows the knock-out, and every clip is
used.

## Sound

The clips were generated once in the owner's ElevenLabs workspace (prompts in
`public/arena/fight/CREDITS.md`), trimmed of leading silence, peak-normalised and re-encoded
(mono 96 kbps; the music stereo 80 kbps). `npm run arena:check-audio` checks that every clip in
`FIGHT_CLIPS` exists, is under its size cap (800 KB for the music, 200 KB for the rest) and has a
credits row. There are no spoken lines; the announcer's calls are on-screen text.

## Accessibility

The canvas has a text alternative. With `prefers-reduced-motion`, screen shake is off and flashes
are softened. All text is Dutch.
