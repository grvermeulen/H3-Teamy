# City Arena: missions, money, driving and radio

Date: 2026-09-18. Status: implemented for release 0.4.0; see the verification record below for evidence and test limits. The sections below preserve the content and design brief. All dialogue, objectives, hints and interface copy ship in Dutch.

Build a city where a recognisable person on a street corner gives you a job, explains the stakes, calls you during its twists, and pays you when it is finished. Ship **24 authored, multi-step missions**, six per existing map zone, with delivery, racing, robbery, assassination, escort, pursuit, recovery and absurd radio-character stories. Support these with smoother speed-based camera movement, tougher vehicles, visible carjacking, and **12 new radio pieces**.

## 1. What exists and what needs changing

### Implementation and verification record — 18 September 2026

- Implemented all 24 definitions, eight street contacts, 185 validated map anchors, scripted actors, optional tasks, Dutch conversations and progressive hints. The catalogue playthrough test finishes every authored objective sequence and checks once-only payment. It drives objective observations, so it does not represent 24 manual driving playthroughs.
- Added a separate **Soloverhaal** entry with local, versioned progression, checkpoint retry, wallet and best medals. Multiplayer imports no local rewards. New rounds last 12 minutes, unlock the zone catalogue and refuse contracts that cannot fit the remaining time plus 30 seconds.
- Scoring version 2 uses `250 × kills + earned cash`. Deaths break ties. Receipts travel with host snapshots and are validated on result submission. Casual multiplayer remains host-reported, not a server-authoritative anti-cheat system. Historical version 1 results retain their separate leaderboard.
- Deploy additive migration `20260918060000_arena_mission_scores` before the new application. Protocol 3 rooms and snapshots exclude incompatible clients; existing rooms require a new room. Full/delta snapshot tests cover eight simultaneous contracts, large actor routes, retained payouts and 750-HP vehicles under the 48-KiB wire limit.
- Implemented continuous camera zoom and eased look-ahead, increased every vehicle class's HP, animated reserved-door boarding and driver ejection, and tripled all 12 location-bonus durations. Shots gain 25%; radio gain is 0.40 instead of 0.50.
- Produced twelve new original MP3s, retaining the original six. The 18 tracks across nine stations include Dutch sermons, spoken satire and four summer vocal trance tracks. They are mastered to a -18-LUFS target / -1.5-dBTP ceiling, encoded at 44.1 kHz / 128 kbps and checked with ffprobe. Complete speech transcriptions were reviewed for Dutch content; this is not a physical speaker/headphone listening certification. Generator selection supports a station plus `--track=N`, and `--dry-run` makes no generation request.
- Chromium desktop and 390×844 touch-viewport mission tests start M01 at Noor, accept, finish all stages, receive €325 and preserve it after reopening solo mode. The browser fixture moves between validated anchors; it tests real interactions and UI, not route-driving duration. TV tests use two authenticated phone contexts, movement and second-screen takeover; hybrid tests cover controller input and gamepad disconnect. Evidence is local under `.cache/arena-mission-verification/`.
- Database integration uses a disposable PostgreSQL instance and includes a cash-only winner, rejection of inflated/duplicate rewards, and idempotent result submission. Real phone hardware, every mission's manual driving time and hardware FPS percentiles remain outside these automated checks; no universal frame-rate claim is made.

The implementation uses written mission conversations; essential instructions remain available in the journal. Mission broadcasts temporarily replace the player's radio and restore its position afterwards. Track order is sequential without adjacent repeats on multi-track stations; the game menu offers **Volgend radionummer**. These are the shipped playback choices instead of the earlier proposed spatial radio and shuffled playlists.

This table records the starting point before implementation. The extensions are now in the working implementation.

| System       | Current implementation                                                                                             | Planned extension                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Simulation   | Fixed-step logic in `src/lib/cityArena/sim/`; traffic, pedestrians, police, combat and landmarks exist             | A deterministic mission runner, persistent named contacts, scripted actors and mission events                           |
| Missions     | `launcher/MissionCard.tsx` displays multiplayer rooms; it is not a mission system                                  | Separate mission definitions, progression, objective HUD, dialogue and journal                                          |
| World        | Four zones: Rhenen, Wageningen, Bennekom and campus; landmark keys and road navigation exist                       | Authored street anchors and validated routes inside each zone                                                           |
| Scores       | `net/scoreboard.ts` ranks kills, then deaths; `arenaMatchService.ts` separately verifies winners and saves results | Cash earned, mission completions and a shared versioned score formula through simulation, network, API, database and UI |
| Camera       | `render/camera.ts` switches discrete zoom at 12/9 m/s; already eases position                                      | Continuous visual zoom, filtered velocity and look-ahead; retain discrete raster cache levels                           |
| TV rendering | `splitScreen.ts` / `renderSplitScreen.ts` already scale continuous visual zoom over discrete raster zoom           | Reuse this approach for the normal camera and retain group framing on TV                                                |
| Hijacking    | `sim/boarding.ts` immediately removes the AI driver and seats the player with a boarding delay                     | Door opening, driver ejection, entry and door closing as a replicated sequence                                          |
| Radio        | Six stations, each with one 120-second track; generator forces instrumental output                                 | Three additional stations, vocal composition, spoken segments and a larger playlist                                     |

Reuse `world/navigation.ts`, `roadGraph.ts`, `pathFollow.ts`, `nearestRoad.ts`, collision queries, landmark placement and existing audio playback. Keep mission business logic in `src/lib/cityArena`, persistence in `src/lib/services`, and UI components as presentation/input adapters. No new runtime mission-framework dependency is needed for a small typed state machine. Read the installed Next.js guides before changing routes or framework components.

## 2. Player experience and scope

### Finding and starting jobs

- Place eight named contacts on reachable pavement, two per zone, each offering three missions. Give each a recognisable outfit, name label and distinct marker. Contacts stand or walk within a small authored area; ambient population recycling must not delete them.
- Map icons distinguish available, locked, active and completed work through shape and text as well as colour. Selecting a contact plots the existing walking/driving route. Locked missions explain their exact prerequisite.
- Within 3 metres, display `Praat met Noor` or the appropriate name. Interaction opens a short conversation, mission description, reward range, difficulty, estimated duration and any vehicle requirement. Explicit `Aannemen` starts the mission; `Later` leaves it available.
- Add one shared interaction resolver. On foot, prefer an active mission handover, then the contact the player faces, then boarding, then a landmark activity. In a vehicle, the normal interaction exits. Show exactly the action the resolver will execute; provide cycling when equally close targets compete. This prevents an adjacent car swallowing the conversation button.
- Keyboard uses the existing E interaction, touch uses a labelled contextual button, and gamepad/phone controller use their mapped interaction action. Dialogue navigation and accept/cancel must travel through the controller input path in TV mode too.

### Following a mission

- One active mission per player. HUD: title, `Stap 2/5`, a short objective, distance, relevant timer/cargo/escort meter and expected payout. The full conversation and completed steps stay in `Missielogboek`.
- Objective markers distinguish a person, vehicle, pickup, search area, checkpoint and delivery area. Reuse route guidance; a search objective first shows a search area rather than revealing the answer immediately.
- Each stage has an instruction on entry, a contextual hint after 20 seconds without progress, and a more explicit hint after 45 seconds. `Hint tonen` reveals the next hint immediately. Suspend inactivity hints during dialogue, pause, loading and reconnection; hints have no cash penalty.
- Conversations are two to four short exchanges, with speaker names and a recap. Skipping advances presentation only, never grants objective progress. Essential information is always written; voice acting for all mission dialogue is not required for this release.
- Solo dialogue pauses simulation and timers. Multiplayer dialogue leaves the world running, suppresses fire input while focused, and closes to a readable recap if the player is attacked or moves out of range. Never grant conversational invulnerability.
- Finish with `Missie voltooid`, base pay, each earned bonus and total. Failure states say what happened and offer `Opnieuw proberen` or `Stoppen`; never silently remove the objective.

### Session and multiplayer rules

- All 24 missions work in solo exploration. Story unlocks and first completions are saved locally as versioned, non-ranked progress. An interrupted mission restarts from its briefing on a new solo session; no half-restored vehicles or actors.
- Timed multiplayer uses the same mission content and per-player progress, with the room host simulating objectives. Only offer missions whose estimated duration plus a 30-second margin fits the remaining round. At the deadline, unfinished missions end with an explanation and no payout; finalize completions from the last valid simulation tick first.
- Every mission remains inside its current zone. Do not route a player across the arena boundary into zone damage. Later cross-city campaigns require a separate world-travel feature.
- Story prerequisites apply in solo. Multiplayer unlocks the zone's full catalogue at round start so local save progress cannot advantage players; still enforce one active job and once-per-mission payout per player per round.
- No cooperative reward splitting in this first release. Multiple players can run contracts independently; mission targets and vehicles are tagged to their own instance. Competitors can interfere through normal world physics/combat, with an explicit failure/retry if an essential target is lost.
- Contacts themselves are invulnerable, non-blocking and excluded from ambient scoring. Mission enemies and escorts are ordinary vulnerable actors. This prevents permanently deleting the entry point to content.
- Mission state, pending hijacks and cash survive host takeover via snapshots. Same-round reconnect restores the member's run; permanent departure cleans up their mission after a 60-second grace period. Starting a new round clears cash and active runs.

## 3. The 24 missions

Rewards below are proposed integer game euros, to be tuned through timed playtests. Every listed mission has a guaranteed base reward on success and one optional bonus. All start at named street contacts; other locations are mission destinations. Fictional crime premises belong to the invented characters and targets.

Each mission receives full briefing, stage-transition, failure and completion dialogue during content implementation. The opening and hint below establish the intended writing and gameplay, not merely a title for a future idea.

### Rhenen — deliveries, wheels and the first score

**Contacts:** Noor Koerier on the pavement outside `gastland`; Mo Motor beside a fictional garage on a validated road near `klein-zwitserland`.

| ID / mission                | Start and unlock            | Multi-step objectives                                                                                                                                               | Payment / time                                    | Dialogue, hint and failure                                                                                                                                                                                                              |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M01 · Verkeerd bezorgd      | Noor; available immediately | Collect a sealed parcel → inspect the delivery note → reach a marked street door near Cunerakerk → learn the recipient moved → deliver to the marked second address | €250 + €75 for delivery within 3 minutes; 3–4 min | Noor: “Niet schudden. Als het tikt, is het waarschijnlijk een klok.” Hint: “Lees het briefje in je missielogboek; het tweede adres staat onderaan.” Fail only on death or abandonment; missing the bonus time still permits completion. |
| M02 · Breekbaar geluk       | Noor; after M01             | Collect three crate props → load the marked van → drive to two drop-offs → return the empty van                                                                     | €450 + €100 if cargo stays above 75%; 4–5 min     | “Glaswerk. Geen percussie-instrumenten.” Hint: “De ladingmeter daalt bij een harde klap, niet bij iedere bocht.” Cargo has its own impact meter; fail if cargo reaches zero or the van is destroyed.                                    |
| M03 · De laatste bestelling | Noor; after M02             | Pick up a hot meal → reach the first customer → receive a second order by radio → choose the order of two remaining stops → return the receipt                      | €550 + €150 if all meals stay warm; 4–6 min       | “Drie klanten, twee handen, één veel te optimistische planning.” Hint: “Kies op de kaart welke bestelling je eerst aflevert.” Cooling reduces bonuses; fail if a customer remains unserved at the generous six-minute deadline.         |
| M04 · Rondje Rhenen         | Mo; available immediately   | Borrow a supplied compact → stage on the grid → pass eight ordered checkpoints → finish → park beside Mo                                                            | €350 + €100 for gold time; 3–4 min                | “Je wint bij de finish, niet bij de eerste lantaarnpaal.” Hint: “Volg de brede poorten; alleen de volgende telt.” Fail on wreck or bronze cutoff; missing gold only loses the bonus.                                                    |
| M05 · Geleende wielen       | Mo; after M04               | Find the marked moving sedan → get alongside its driver door → hijack with the new animation → lose police attention → deliver with at least 25% HP                 | €650 + €150 for at least 70% HP; 4–6 min          | “De eigenaar heet tegenwoordig ‘niet jouw probleem’.” Hint: “Wacht tot de auto afremt bij de kruising; benader de bestuurderskant.” Fail on wreck, player death or target escape.                                                       |
| M06 · Een koffer te veel    | Mo; after M05               | Meet a nervous courier → take the marked case → survive an ambush → change vehicles → break pursuit → hand the case to Noor                                         | €900 + €200 without losing cargo; 5–7 min         | “Eén koffer. Twee achtervolgers. Ik had duidelijker moeten onderhandelen.” Hint: “Een andere auto helpt pas als niemand je ziet overstappen.” Fail on death or loss of the case; the ambush enemies use explicit mission actor IDs.     |

### Wageningen — robberies, surveillance and contract targets

**Contacts:** Vera Voss at a fictional kiosk near `grote-kerk-wageningen`; Dex De Schakel on the pavement 160 metres west and 80 metres north of `grote-kerk-wageningen`.

| ID / mission              | Start and unlock            | Multi-step objectives                                                                                                                                                                           | Payment / time                                                  | Dialogue, hint and failure                                                                                                                                                                                                             |
| ------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M07 · Kassa dicht         | Vera; available immediately | Pick up an empty bag → enter a marked exterior interaction area at a fictional shop → hold interaction while an arcade progress meter fills → collect loot → escape attention → deliver         | €500 + €150 without civilian casualties; 3–5 min                | “De kassa gaat dicht. De zak gaat open.” Hint: “Blijf in het gemarkeerde vak totdat de tas gevuld is.” Fail on death or abandoned loot. No new building interiors required.                                                            |
| M08 · Zwaar transport     | Vera; after M07             | Locate a mission van on patrol → stop it without wrecking it → open its marked cargo interaction → collect two loot bags → deliver using a different vehicle                                    | €900 + €200 for extracting both bags within 90 seconds; 5–7 min | “Alles is verzekerd. Behalve mijn geduld.” Hint: “De buit verdwijnt als je het hele voertuig opblaast.” Fail on van destruction before extraction or lost essential loot.                                                              |
| M09 · De grote wissel     | Vera; after M08             | Collect a decoy case → meet a street courier → make the scripted exchange → pursue the thief who takes the real case → recover it → deliver                                                     | €1,100 + €250 without damaging the case; 6–8 min                | “Jij wisselt de koffers. Niemand wisselt jou in.” Hint: “Volg de gemarkeerde koerier, niet het busje dat wegrijdt.” Fail if the thief escapes the pursuit route or the real case is destroyed.                                         |
| M10 · Schaduw op straat   | Dex; available immediately  | Identify a marked fictional gang lookout → follow at 20–60 metres → wait at two observation points → inspect the stash they reveal → report to Dex                                              | €550 + €150 without filling the suspicion meter; 4–6 min        | “Als hij je naam leert, heb je te dichtbij gestaan.” Hint: “De meter stijgt vlak achter hem; wacht bij het volgende observatiepunt.” Fail if suspicion stays full for five seconds or the target is killed.                            |
| M11 · Laatste halte       | Dex; after M10              | Collect the target description → identify the fictional armed enforcer by matching two visible clues → confirm identity through interaction → eliminate that target → escape → report           | €1,000 + €250 without civilian casualties; 5–7 min              | “Rode jas, zilveren koffer. Eerst kijken, dan handelen.” Hint: “Beide kenmerken moeten kloppen; het logboek bewaart de beschrijving.” Fail if the target escapes or a decoy is killed. Ordinary pedestrians never count as the target. |
| M12 · Konvooi zonder baas | Dex; after M11              | Collect the convoy route → follow its three mission vehicles → identify the leader's marked car at a meeting → eliminate the fictional gang leader → recover their case → leave the search area | €1,400 + €300 if the escort vehicles survive; 6–8 min           | “Drie auto's. Eén baas. De rest factureert alleen.” Hint: “Bij het ontmoetingspunt stapt de leider uit; herken hem vóór je aanvalt.” Fail if the leader escapes or the case is lost.                                                   |

### Campus — science deliveries, escorts and paranoid broadcasting

**Contacts:** Ada Ampère outside `wur-forum`; Bas Bewijs with a portable broadcasting table on the pavement outside `wur-orion`.

| ID / mission                                 | Start and unlock           | Multi-step objectives                                                                                                                                                                         | Payment / time                                                 | Dialogue, hint and failure                                                                                                                                                                                                                                          |
| -------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M13 · Koel hoofd                             | Ada; available immediately | Take a sample cooler → collect samples at three outdoor campus props → keep the cooler supplied at one optional recharge point → deliver to Atlas                                             | €450 + €150 for at least 80% freshness; 4–5 min                | “Het is onderzoek, geen smoothie.” Hint: “Bij de blauwe koelbox kun je de koeling herstellen.” Fail at zero freshness; ordinary bumps reduce cargo only above the impact threshold.                                                                                 |
| M14 · Professor op de vlucht                 | Ada; after M13             | Meet a nervous fictional researcher → supply a passenger-capable sedan → wait for boarding → escort past a mission ambush → stop inside the Atlas drop-off → walk them to the entrance        | €800 + €200 for at least 80% escort health; 5–7 min            | “Zijn presentatie is zoek. Helaas hebben zijn achtervolgers wel een routekaart.” Hint: “Stop volledig in het vak zodat je passagier veilig kan uitstappen.” Fail on escort death, vehicle destruction while occupied, or separation longer than 30 seconds on foot. |
| M15 · Campus zonder remmen                   | Ada; after M14             | Pick up a supplied sport car → complete a calibration slalom → pass ten ordered time-trial gates → stop inside the finish box → return the recorder                                           | €700 + €200 for gold time; 4–5 min                             | “Dit onderzoek is dubbelblind. De remmen doen het gelukkig gewoon.” Hint: “De laatste opdracht is stilstaan, niet door de finish vliegen.” Fail on wreck or bronze cutoff.                                                                                          |
| M16 · Duiven met wifi                        | Bas; available immediately | Collect a signal scanner → investigate three search areas → interact with the transmitter props → discover an ordinary campus router → deliver the recording                                  | €400 + €100 for finding the optional fourth recording; 4–5 min | “Ze landen nooit naast een stopcontact. Denk daar maar eens over na!” Hint: “De scanner piept sneller als je dichter bij het gemarkeerde signaal komt.” Fail on death or abandonment; the reveal punctures Bas's theory.                                            |
| M17 · Het algoritme achtervolgt me           | Bas; after M16             | Meet Bas → escort him to a marked van → drive through three upload areas while followers pursue → park for a final upload → bring him back                                                    | €850 + €200 without interruption of the final upload; 5–7 min  | “Ik word gevolgd! Goed voor mijn bereik, slecht voor mijn bloeddruk!” Hint: “Het uploadvak werkt alleen als de auto stilstaat.” Leaving the area pauses, rather than resets, upload progress; fail on Bas's death or van destruction.                               |
| M18 · De waarheid past niet op een USB-stick | Bas; after M17             | Recover three fragments from fictional courier NPCs → assemble them at an outdoor terminal → discover a scheduled marketing campaign → protect the terminal for 45 seconds → deliver the file | €1,100 + €250 for keeping terminal health above 75%; 6–8 min   | “Als het reclame is, waarom weet de reclame dan dat ik kijk?” Hint: “De drie fragmenten zijn apart gemarkeerd; je mag zelf de volgorde kiezen.” Fail on terminal destruction; completed fragment collection survives the defence checkpoint in solo.                |

### Bennekom — pasta faith, strange rescues and the local finale

**Contacts:** Broeder Fusilli at a fictional food truck near `oude-kerk-bennekom`; DJ Zonnedauw beside a fictional radio van 180 metres west and 80 metres north of `oude-kerk-bennekom`.

| ID / mission                   | Start and unlock                 | Multi-step objectives                                                                                                                                                                                         | Payment / time                                                  | Dialogue, hint and failure                                                                                                                                                                                                                                         |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M19 · Nood aan noedels         | Fusilli; available immediately   | Collect three ingredient crates → load a van → deliver to two outdoor congregation spots → bring back the sacred colander                                                                                     | €350 + €100 without damaging a crate; 3–5 min                   | “Het monster ziet alles. Behalve door een dichte pastapan.” Hint: “De krat met het vergiet moet als laatste terug naar de foodtruck.” Fail on van destruction before deliveries or lost colander.                                                                  |
| M20 · Ramen op wielen          | Fusilli; after M19               | Fetch the supplied speaker van → visit three sermon stops → remain parked for a short rave sermon at each → evade angry fictional rival promoters → return                                                    | €650 + €200 with all speakers intact; 4–6 min                   | “Draai links bij de zonde en zet de bas harder!” Hint: “De preek begint zodra je in het vak stilstaat; blijf daar tot het refrein.” Fail on speaker-van destruction; use new radio audio as mission-local playback with text captions.                             |
| M21 · De heilige vergieting    | Fusilli; after M20               | Find a stolen gold colander → sneak past a patrol using a visibility meter → take it from an outdoor display → choose an escape route → return before the ceremony                                            | €1,000 + €250 without raising the alarm; 5–7 min                | “Zonder vergiet is het gewoon een man met warme pasta.” Hint: “Wacht tot de patrouille naar het andere vak loopt.” Alarm changes the escape into pursuit rather than immediate failure; fail on death, lost item or seven-minute deadline.                         |
| M22 · Baslijn reddingslijn     | Zonnedauw; available immediately | Recover a stranded vocalist → fetch the marked sound van → collect a guitar and synth at two stops → deliver everyone to the outdoor stage                                                                    | €500 + €150 with all equipment above 80%; 4–6 min               | “De zanger is er, de apparatuur niet. Dat heet normaal akoestisch, vandaag paniek.” Hint: “Eerst de bus ophalen; de complete set past niet in een personenauto.” Fail on escort death or destruction of essential gear.                                            |
| M23 · De laatste zonsondergang | Zonnedauw; after M22             | Find doomsday caller Kees → collect his three ridiculous survival props → escort him through a checkpoint route → reach the lookout before his countdown → hear him reschedule the apocalypse                 | €750 + €150 for completing the optional lookout detour; 5–6 min | Kees: “Het einde is nabij! Na het verkeersbulletin!” Hint: “De aftelklok is van Kees; de bestemming blijft gewoon op je kaart staan.” Fail at the announced deadline or escort death; the scene then reveals his prediction was wrong.                             |
| M24 · Laat de stad trillen     | Zonnedauw; after M23 and M21     | Retrieve a generator → recover a stolen audio truck → transport Fusilli and the vocalist on separate pickup stops → protect the outdoor setup for 60 seconds → deliver the transmitter → start the final rave | €1,800 + €400 for at least 75% equipment health; 8–10 min       | “Stroom, stem, speakers. Als jij rijdt, regelen wij de rest.” Hint: “De generator moet eerst op zijn plek staan voordat de zender werkt.” Fail on essential actor/equipment death. Solo checkpoints after truck recovery and passenger delivery; one final payout. |

### Variety and replay

The catalogue includes fragile cargo, delivery-order choice, timed multi-stop service, checkpoint racing, a driving hijack, vehicle switching, two robbery structures, a case swap/chase, tailing, target identification, convoy combat, temperature management, passenger escort, slalom/precision parking, signal searches, uploads, defence, mobile sermons, stealth theft, equipment collection and a multi-system finale.

First clear pays base plus earned bonus. Solo replay pays 50% of base plus 50% of earned bonus, rounded down once on the final total, after a five-minute contact cooldown. No extra cash for checkpoint retries or repeated completion clicks. Multiplayer pays each mission once per player per round; other missions remain available. Variation seeds may change drop-off order, traffic pressure, target vehicle colour and route alternatives, but never rewrite the briefing inconsistently or remove necessary clues. Show bronze/silver/gold records using time, bonus completion and relevant damage; medals are progression, not an extra hidden cash multiplier.

## 4. Mission implementation

### Definitions and state

Add `src/lib/cityArena/missions/` with `types.ts`, `catalog.ts`, `contacts.ts`, `anchors.ts`, `objectives.ts`, `runner.ts`, `dialogue.ts` and `rewards.ts`. Split catalogue content by zone if it becomes unwieldy. Exported APIs receive JSDoc.

Definitions contain stable mission/contact IDs, zone, prerequisites, duration estimate, required resources, reward rules and a directed graph of stages. Each stage holds Dutch objective/hint/dialogue IDs, a typed objective, success/failure transitions, optional timer and permitted solo checkpoint. Validate content with Zod at the authored-data boundary; keep the fixed-tick loop free of repeated parsing.

Use a discriminated union of objective types: `talk`, `reach`, `interact`, `collect`, `deliver`, `enterVehicle`, `hijackVehicle`, `driveCheckpoints`, `follow`, `identify`, `eliminate`, `escort`, `defend`, `escapeWanted` and `composite`. Cargo freshness, damage, suspicion and hold progress are typed modifiers with explicit units. Race gates use swept segment crossing in order so a fast car cannot tunnel over a checkpoint between ticks. A cargo item can be carried by exactly one player or vehicle.

Runtime state includes `instanceId`, `definitionId`, `definitionVersion`, owner/player ID, stage, start/stage ticks, actor bindings, inventory, counters, timer deadlines, hint progress, checkpoint and outcome. State follows `offered → active → completed | failed | abandoned`. A failed run creates a new attempt when retried; a checkpoint belongs to its parent contract so restoring one cannot mint another payout.

Update the runner after movement, collisions and combat have produced this tick's events. Stage transitions consume authoritative state and events, not UI callbacks claiming success. At most one stage transition per instance per tick; define whether the next stage can consume the triggering event so collect-and-deliver cannot accidentally finish together. Same-tick death or destruction of a required asset beats completion; a successful completion on the last permitted tick beats timeout.

### Actors and map placement

- Resolve contact/destination anchors from the existing landmark keys plus authored pavement offsets. Secondary garages, shops and stages are fictional outdoor props. Never use a building centre as a walkable destination.
- Validate each start, target and race gate against walkability/drivability, road connectivity and the selected zone boundary. Store the resolved anchor set with a map version. A missing anchor produces a content validation failure before release, not a fallback objective at world origin.
- Add mission actor roles for armed enemies, walking escorts, passengers and racers. Reuse pedestrian/driver navigation, collision and combat. Passenger seats are explicit bindings; entering a car must not overwrite the driver's player binding. Provide a stuck recovery policy that replans first and only relocates an unseen actor to a validated nearby point.
- Reserve objective actors against traffic/pedestrian recycling until completion. Actor IDs use the world's allocator and ownership tags, never array indices. On cleanup, remove mission props/enemies and release borrowed vehicles only after checking that no player occupies them.
- Budget initially at four extra mission NPCs and two extra mission vehicles per player, 32 NPCs and 16 vehicles for eight participants. Sequence large scenes rather than spawning every future actor at acceptance. Profile these proposed limits on the existing TV mode before raising them.

### Network and saving

Extend simulation state, input/action messages, full/delta snapshots, validators, host/client loops and host-migration restore. The host validates interaction distance, ownership, stage and prerequisites. Accept/decline/dialogue choices use a reliable sequence-numbered action path with deduplication; snapshot acknowledgement allows retry. Other players receive enough actor/run state to render the world, while dialogue text comes from the local versioned catalogue.

A content/protocol version mismatch rejects joining with a Dutch refresh instruction. Include elapsed stage state, paid contract IDs and actor bindings in takeover snapshots. Keep a bounded per-round completion ledger so duplicate event playback or reconnect cannot increase cash. Freeze mission progression and scoring at the round boundary.

Solo saves store completed mission IDs, medal records, unlocks, wallet and a version. Apply completion and wallet updates together; reload must not replay a just-paid completion. Saves are explicitly local progression and never accepted as ranked result evidence. Logged-in cloud story sync can be added separately without blocking this release.

## 5. Cash and scoring

Track separate integer values for wallet (`cashBalance`), gross mission cash earned this round (`cashEarned`) and completed missions. Future purchases can reduce the wallet without reducing the score. Death does not erase completed earnings. No cash drops from random pedestrians and no cash transfer loop.

Proposed formula: **score = cashEarned + 250 × playerKills**. Mission NPC kills do not also count as player kills. Deaths are a tiebreaker rather than a negative currency balance. This makes a €500 delivery worth two player kills and leaves high-risk missions meaningful; adjust the versioned coefficient after playtests if one strategy dominates.

Rank by score descending, then deaths ascending, then player ID only for stable display order. All players equal on score and deaths share the win; no winner if the best score is zero. Example: two kills and €700 earns 1,200 points; four kills and no cash earns 1,000. A cash-only player can win.

Use one pure scoring policy shared by `net/scoreboard.ts` and `src/lib/services/arenaMatchService.ts`; do not duplicate winner logic. The server recomputes totals and winners from the submitted fields, checking nonnegative bounded integers, eligible missions, duplicate completion IDs, catalogue rewards and elapsed-time plausibility. Host-reported gameplay remains host-reported: these validations prevent malformed/duplicate payouts but do not make the browser host cheat-proof.

Thread the new data through:

1. Mission completion → atomic wallet/cash change and unique payout receipt.
2. Simulation/tally → full/delta snapshots → HUD and `ArenaScoreboard`.
3. `useMatchClock.ts` → `src/lib/schemas/arena.ts` → existing result endpoint/service.
4. Additive Prisma migration for result `cashEarned`, `missionsCompleted`, `score` and `scoringVersion`, and match/round rules version as needed. Store mission receipts with a unique round/player/contract constraint if used in result validation.
5. Global leaderboard: wins first, accumulated score second, earned cash third; show score and cash alongside kills/deaths. Filter the new ranking to scoring version 2; retain historical version 1 results as an explicitly labelled legacy view rather than mixing incompatible wins.

HUD copy: `Geld €1.250`, `Verdiend €850`, `Score 1.350`, `Missies 2`. Completion shows the breakdown; the scoreboard explains `€1 verdiend = 1 punt · uitschakeling = 250 punten`. Deploy schema and compatible result readers before enabling version 2 rooms. Ongoing old-version rounds finish under their original policy.

## 6. Dynamic camera and smoother panning

Treat zoom as a continuous visual scale over the existing discrete raster resolutions. Reuse the TV renderer's scale ratio rather than introducing a different chunk cache key for every fractional zoom.

Proposed tuning relative to the current viewport-derived base zoom:

| Speed   | Visual zoom target | Intended feel                              |
| ------- | ------------------ | ------------------------------------------ |
| 0–3 m/s | 1.12 × base        | Close enough for people, doors and pickups |
| 8 m/s   | 1.00 × base        | Normal street driving                      |
| 18 m/s  | 0.82 × base        | More room to plan a turn                   |
| 30 m/s  | 0.68 × base        | Fast pursuit framing                       |
| 36+ m/s | 0.62 × base        | Maximum road visibility                    |

Interpolate with a smooth curve, using filtered actual velocity magnitude rather than throttle or vehicle class. Reverse uses speed magnitude for scale but velocity direction for look-ahead. Clamp output to sensible phone/desktop visibility after inspecting the real viewport; do not let a raster minimum of 4 silently stop visual zooming out.

Use frame-rate-independent exponential smoothing: `alpha = 1 - exp(-dt / tau)`. Initial time constants: speed filter 0.20 seconds, zoom out 0.35 seconds, zoom in 0.75 seconds, camera follow 0.18 seconds and look-ahead 0.30 seconds. Grow look-ahead from 2 metres at low speed to 25 metres at speed, capped at 25% of the visible short dimension. Filter direction changes so collisions and quick reversals do not whip the view.

Update render transforms, pointer aiming, world/screen conversion, culling, navigation overlays and minimap consistently. Discrete raster selection uses hysteresis and bounded prewarming; fractional display changes cannot trigger unbounded rerasterisation. Preserve the existing per-frame raster budget. Teleport/respawn resets camera history; entering/exiting a vehicle eases to the new target without a zoom jump.

TV cameras must frame every player in their group: use the wider of the speed-based requirement and group-fit requirement, with one camera state per view. Reduced-motion mode uses a stable zoom per travel mode and minimal look-ahead, disabling extra sway; preserve a manual `Dynamische camera` setting.

Acceptance: no visible threshold jump during steady acceleration; no oscillation at 9–12 m/s; no camera reversal overshoot after a crash; correct aiming at every scale; equivalent behaviour at 30/60/120 FPS; no new chunk-cache growth during a two-minute speed sweep.

## 7. Vehicle durability

Increase HP moderately while preserving weight/handling differences. Proposed starting values:

| Vehicle     | Current HP | Proposed HP |
| ----------- | ---------: | ----------: |
| Compact     |        100 |         160 |
| Sedan       |        100 |         180 |
| Sportwagen  |        100 |         160 |
| Politieauto |        100 |         210 |
| Bestelbus   |        140 |         230 |
| Pick-up     |        120 |         210 |
| Stadsbus    |        220 |         350 |
| Oldtimer    |         70 |         120 |
| Trekker     |        180 |         300 |
| Tank        |        600 |         750 |

Make `healthMaxOf(kind)` the source for spawning, repairs, smoke, HUD ratios, cargo bonuses and tests. Audit health quantization and wire limits: vehicles above 255 HP must survive full/delta snapshots without clipping. Keep the smoke threshold at 40% of each kind's maximum.

Inspect wall and vehicle collision damage before changing it. Damage should reflect a new impact and lost normal speed, not continuous harmless contact while scraping. Fix repeated-contact damage only if a focused reproduction demonstrates it. Do not simultaneously reduce every weapon's damage; first playtest these HP values against existing combat.

Acceptance: routine parking bumps are survivable; a delivery van completes an ordinary five-minute route with several modest mistakes; major crashes and sustained gunfire remain dangerous. Measure same-speed impact scenarios before/after and record health remaining, rather than declaring a vehicle durable based solely on its spawn HP.

### Special-location bonuses last three times as long

User requirement added 2026-09-17: triple the active duration of every special-location bonus. Apply this in delivery slice 1 alongside driving feel and vehicle durability, using the existing `seconds` values in `src/lib/cityArena/world/landmarkActivities.ts` as the source of truth.

| Special location            | Current duration | New duration |
| --------------------------- | ---------------: | -----------: |
| Basketbal · Bellefleur 5    |             30 s |         90 s |
| Brouwerij Klein Zwitserland |             25 s |         75 s |
| Zwembad 't Gastland         |             40 s |        120 s |
| Café Onder de Linden        |             25 s |         75 s |
| Cunerakerk                  |             40 s |        120 s |
| Grote Kerk Wageningen       |             30 s |         90 s |
| Oude Kerk Bennekom          |             35 s |        105 s |
| De Bongerd                  |             40 s |        120 s |
| De Vrije Slag               |             45 s |        135 s |
| WUR Forum                   |             40 s |        120 s |
| WUR Orion                   |             35 s |        105 s |
| WUR Atlas                   |             30 s |         90 s |

Retain the existing effect strength, one-bonus-at-a-time rule and 15-second rest after expiration. The brewery's protection lasts longer; alcohol duration continues to follow the existing beer system. Update duration values once in the activity catalogue, so prompts, HUD and host-side expiration share the same timing rather than applying another multiplier in the simulation.

Verify bonus expiration at the new tick deadline, recovery over the extended duration with the health cap, the 15-second post-bonus rest, death cleanup, and the displayed remaining time. Confirm host migration and full/delta snapshots preserve the longer deadlines. Acceptance: all 12 locations grant exactly three times their previous active duration.

## 8. Animated driving hijacks

Keep hijacking moving AI traffic possible. Initiate when the player is within reach of the driver door, the car is intact, the door side has room and no other player has reserved it. Ordinary player-occupied cars remain excluded for this release. For traffic above 8 m/s, show `Te snel — wacht tot de auto afremt`; authored hijack routes include predictable slow intersections. Do not instantly snap a fast car to zero speed.

Use a fixed-tick sequence of about 1.3 seconds at the existing 30 Hz simulation rate:

| Phase | Ticks | Simulation/render behaviour                                                            |
| ----- | ----: | -------------------------------------------------------------------------------------- |
| Reach |   0–5 | Reserve the car and move the player to the reachable door; driver brakes naturally     |
| Open  |  6–12 | Driver door rotates to roughly 65 degrees around its hinge                             |
| Eject | 13–22 | Spawn exactly one visible driver pedestrian; animate a short outward throw and landing |
| Enter | 23–32 | Move player into the seat; commit ownership once the original driver is out            |
| Close | 33–39 | Door swings shut; release normal driving input                                         |

Store start tick, phase, owner, vehicle ID, original driver state, door side and ejected pedestrian ID in simulation state. Rendering interpolates progress; it never decides seat ownership. Blend the driver sprite to the ground, then transition to standing/fleeing. Use safe ejection placement from existing collision resolution and test both blocked-door and water-edge cases. A visible occupant silhouette before the throw makes it clear who came out.

Before ejection, cancellation restores the original driver controller. After ejection, cancellation leaves an empty vehicle and the ejected driver alive in the world. If the player dies, the vehicle wrecks, the door becomes blocked or the peer disconnects, cancel deterministically and release reservations. Two simultaneous hijacks resolve by authoritative input order with player ID as a stable tie-break. Generate the wanted event once when the theft commits.

Add doors as a body-coloured hinged render layer, with per-kind geometry for cars/vans/bus/tractor. Tank entry uses an appropriate hatch variant and no road-car door. Empty parked cars get a shorter open/enter/close animation without inventing a driver. Add handle, door slam and ejection/grunt sounds using the existing sound event path. Reduced motion shortens displacement but preserves the visible door opening and driver appearing outside.

## 9. Radio expansion: 12 new pieces

Keep the six existing stations and tracks. Add **Radio Ramen**, **Vrije Frequentie** and **Zomerstroom**. Radio Ramen holds the pasta preaching; Vrije Frequentie hosts fictional unstable callers and mock adverts; Zomerstroom plays music with enough uninterrupted space to enjoy a drive. All spoken and sung words are Dutch.

| #   | Station / title                             | Length / tempo  | Brief and original sample copy                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01 | Radio Ramen · De heilige bas                | 150 s / 145 BPM | Broeder Fusilli's ecstatic sermon over acid-rave drums, choir stabs and deep bass. “Geloof in de sliert! Hef uw vergiet! Wie stil blijft staan, hoort de bas nog niet!” Spoken setup → congregation response → full rave drop.                                                               |
| R02 | Radio Ramen · Gekookt in het licht          | 165 s / 140 BPM | Mock devotional trance, organ chords, operatic response and a euphoric synth lead. “Wij zijn gaar, maar niet verloren; laat de ketel ons bekoren.” Give the middle third to instrumental music.                                                                                              |
| R03 | Vrije Frequentie · Alles hangt samen        | 100 s           | Bas Bewijs starts with pigeons, blames routers, roundabouts, supermarket receipts and his own ring light, then advertises a discount code. “Waarom is mijn wachtwoord geheim, maar weet mijn telefoon dat het fout is? Word wakker!” Frantic, fast, clearly fictional character performance. |
| R04 | Vrije Frequentie · Nog vijf minuten         | 90 s            | Doomsday caller Kees predicts the end, argues with the station clock, extends the deadline, then complains about parking. “De wereld vergaat om kwart over! Tenzij de brug openstaat!” Escalating emergency-style music, comic payoff.                                                       |
| R05 | Vrije Frequentie · Ademen op abonnement     | 75 s            | A deranged wellness seller offers premium local air with a monthly breathing limit. “Uw eerste drie ademhalingen zijn gratis. Uitademen valt buiten de bundel.” Lounge keys, fake callers, melodramatic sales climax.                                                                        |
| R06 | Vrije Frequentie · Verkeerslichtfluisteraar | 75 s            | A traffic mystic claims red lights are emotionally unavailable and roundabouts have attachment issues. “Oranje betekent: neem even tijd voor jezelf.” Dub bass, tiny jingles and an increasingly exasperated host.                                                                           |
| R07 | Zomerstroom · Onder dezelfde zon            | 210 s / 128 BPM | Deep progressive summer trance; warm sub-bass, acoustic guitar plucks, piano, airy female lead and layered chorus. “Onder dezelfde zon / rijden we de morgen in / waar de nacht begon / krijgt de dag opnieuw een zin.”                                                                      |
| R08 | Zomerstroom · Warm asfalt                   | 195 s / 130 BPM | Rolling bass groove, Rhodes, live percussion, wide pads and a low male vocal. “Warm asfalt, ramen open / laat de uren verder lopen.” Extended instrumental middle and a final vocal lift.                                                                                                    |
| R09 | Zomerstroom · Blijf nog even                | 210 s / 132 BPM | Emotional duet, piano breakdown, picked guitar, strings and a broad melodic trance drop. “Blijf nog even, blijf dichtbij / laat de laatste zon voor mij.” Musical development across three distinct sections.                                                                                |
| R10 | Zomerstroom · Tot de lucht weer kleurt      | 210 s / 134 BPM | Night-to-sunrise trance, weighty sub, arpeggiated synths, breathy chorus and live-feeling percussion. “Tot de lucht weer kleurt / en de stilte openbreekt / blijf ik waar het licht gebeurt.”                                                                                                |
| R11 | Kade Funk · Badmeester van de nacht         | 150 s / 118 BPM | An overconfident fictional pool DJ sings absurd crowd instructions over slap bass, wah guitar, brass and disco drums. “Niet rennen bij het zwembad / wel dansen in de rij!”                                                                                                                  |
| R12 | Polder FM · De trekker heeft gevoelens      | 150 s / 124 BPM | Country-rave crossover: fiddle, banjo, deep electronic bass and a deadpan sung duet between farmer and tractor. “Je schakelt door, maar vraagt me nooit hoe het gaat.”                                                                                                                       |

This adds 30 minutes of audio. Music tracks use an intro, verse/sermon, development, breakdown and final payoff; avoid a short loop stretched to the requested length. Speech pieces stay shorter so the same joke does not monopolise a journey. Rants are voiced by original fictional characters, with contradictions and comic reveals built into their scripts.

### Gunshots louder, radio slightly quieter

User requirement added 2026-09-17: increase gunshot volume and slightly lower radio volume. Initial mix targets are +25% linear gain for firearm samples in `src/lib/cityArena/audio/clips.ts` and -20% linear gain for `RADIO_GAIN` in `src/lib/cityArena/audio/radio/radio.ts`:

| Sound   | Current gain | Proposed gain |
| ------- | -----------: | ------------: |
| Pistol  |         0.50 |         0.625 |
| Uzi     |         0.40 |          0.50 |
| Shotgun |         0.60 |          0.75 |
| Rifle   |         0.60 |          0.75 |
| Radio   |         0.50 |          0.40 |

These are gain changes, not percentages of perceived loudness. Apply the corresponding increase to firearm synth fallbacks in `sound.ts`; check the cannon's actual sound routing so its shot is also audible without boosting unrelated explosion events. Preserve master volume and other effects. Radio ducking must restore to the new 0.40 baseline, including after overlapping shots or dialogue. Implement this mix adjustment in slice 1; use it as the listening baseline for the new tracks in slice 7.

Acceptance: shots stand out clearly over music and engines on phone speakers and headphones; sustained Uzi fire and simultaneous multiplayer shots do not audibly clip; radio remains comfortably audible between shots. Tune the proposed gains after listening to the combined mix, and verify sound-off and ducking recovery still work.

### Production and playback

Extend `scripts/arena/generate-radio.ts` to use stable track IDs and per-track duration/output mode. Existing index-based regeneration must not overwrite already-approved tracks when new pieces are inserted. Add `--dry-run`, `--track`, and explicit replacement selection; write generation metadata and credits only after validating a successful file. Keep the prior manifest/file usable when generation fails.

The current `force_instrumental: true` blocks this brief. In prompt mode set it according to the track; for controlled lyrics and arrangements use a composition plan. The official API documents prompt and composition-plan modes as mutually exclusive, and its composition guide supports section lyrics, duration and instrumentation. Verify the selected model's exact plan schema before making the first request. Sources: [Compose music](https://elevenlabs.io/docs/api-reference/music/compose), [Composition plans](https://elevenlabs.io/docs/eleven-api/guides/how-to/music/composition-plans), checked 2026-09-17.

Prototype R01, R03 and R07 first: they prove sermon-over-rave, intelligible ranting and musical vocal quality. If music generation sings the rant instead of speaking it, generate the original character speech separately through the existing ElevenLabs audio tooling/provider and mix it over an original music bed offline. Do not ship an unintelligible song as a talk show. Preflight account access, available credits and a batch cost estimate; credentials remain in environment files before generating the authorized production assets.

Listen to each complete output, not only its opening. Check Dutch pronunciation, intelligible speech, evolving musical arrangement, strong low end without clipping, vocals and instrumental breaks. Measure actual duration with ffprobe, trim accidental dead air, and master initially around -16 LUFS integrated with true peak no higher than -1 dBTP; adjust by listening in-game against engines and sirens. Keep bass harmonics audible on a phone, not only a subwoofer.

Store content-hashed MP3s with actual durations, titles, station IDs and source/licence/provenance in the existing manifest and `public/arena/radio/CREDITS.md`. Verify entitlement for final shipped audio against the account's current terms. Stream lazily and retain position per station; shuffle without immediate repeats and allow skipping. Do not preload all 30 new minutes. At 128 kbps the additions are roughly 29 MB; inspect real encoding output and serving behaviour.

Use priority-aware gain ducking: essential mission dialogue over radio, short shot/explosion ducking below that, clean restore after overlap. Never let a later gunshot restore full volume during an ongoing conversation. Mission sermons can play from a nearby van with captions while the personal radio ducks. Controls retain mute, station switching and sound-off semantics, including phone gesture unlock and background/foreground behaviour.

## 10. Delivery sequence and completion gates

These are dependency-ordered implementation slices. Radio scripting and track production can proceed independently of mission code; no extra agents are required by this plan.

| Slice                        | Deliverable and principal files                                                                                                           | Completion gate                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1 · Driving feel             | `render/camera.ts`, normal/TV render paths, pointer aiming, `arenaRuntime.ts`, `sim/vehicle.ts`, damage/wire checks                       | Continuous speed sweep, stable aim, TV group framing, HP before/after impact report                                           |
| 2 · Mission foundation       | New `missions/` modules; simulation integration; actor ownership; contextual interaction; mission HUD/dialogue/journal; local progression | M01 works from street conversation through multi-stage delivery to one payout on keyboard, touch and controller               |
| 3 · Multiplayer and scoring  | Snapshot/action protocol, takeover, scoreboard, result schema/service, additive Prisma migration, leaderboard                             | Two peers plus TV see consistent objectives and cash; takeover and repeated result submission never duplicate reward          |
| 4 · Vehicle entry and actors | Boarding state machine, door/person rendering, audio events, scripted enemies/escorts/passengers                                          | M05 animated traffic hijack and M14 passenger escort are playable, including interruptions                                    |
| 5 · Objective coverage       | Race, robbery, follow, identify, combat, search, defend, cargo and stealth implementations                                                | M04, M07, M10, M11, M13, M16, M18 and M21 prove every reusable objective family                                               |
| 6 · Full content             | All 24 definitions; eight contacts; validated map anchors; full Dutch dialogue and hints; solo checkpoints                                | All 24 authored objective sequences completed by repeatable tests; representative browser playthrough and failure/retry tests |
| 7 · Radio                    | Generator modes and track IDs, 12 approved outputs, manifest/credits, playback/ducking improvements                                       | Duration/encoding/loudness and full speech transcription review; audio checker; no missing files; targeted regeneration       |
| 8 · Release                  | Balance, performance, regression checks, docs, version and changelog                                                                      | All acceptance checks below pass; feature activation after compatible schema/protocol deployment                              |

Start with a complete M01 vertical slice before expanding the catalogue. Then ship one example of each difficult mechanic before authoring variations. The final release gate remains all 24 missions and the requested driving/audio work, even if foundation slices merge earlier behind feature flags.

### Verification

- Unit/integration tests cover business outcomes: stage order; target identity; race gate tunnelling; timers; failure precedence; cargo ownership; suspicion; escort boarding; hint timing; optional bonuses; reward idempotency; checkpoint restore and cancellation cleanup.
- Network tests cover spoofed completion actions, duplicate messages, full/delta snapshots, late join, reconnect, host migration during payout/hijack/escort, out-of-order packets and round deadlines. Include >255 HP and cash near validation bounds.
- Score tests use a cash-only winner, a kill-only winner, combined scores, shared winners, zero-score rounds, legacy policy, API/client agreement and duplicate result recording. Verify the additive migration on a disposable database containing legacy results.
- Hijack tests cover both moving and parked vehicles, all body geometries, a blocked driver door, water nearby, competing claimants, player death and vehicle destruction in every phase. Capture a short visual sequence for animation review.
- Camera tests check transform round trips and equal elapsed-time smoothing; browser driving checks cover narrow phones, desktop, rapid reversal, resize/orientation, reduced motion, 1/2/4/8-player TV layouts and aim alignment.
- Use existing arena browser fixtures and navigation debug tools for mission playthroughs. Complete each mission in its zone and test its failure/retry paths. At least one touch and one TV/controller pass for each objective family. Record actual mission durations to replace proposed timers and gold thresholds.
- Profile eight concurrent missions with traffic/police and radio active. Compare frame-time percentiles, snapshot bytes, actor counts, raster work and memory against baseline. Target 60 FPS on the established desktop baseline and playable 30 FPS on tested phones; identify hardware in the report rather than claiming universal performance.
- Run `npm run arena:check-audio`, sprite/map checks when corresponding assets change, and existing radio autoplay/mute/recovery tests. Inspect all new tracks with ffprobe and listen in-game.
- Before creating/updating implementation PRs: build, typecheck, lint, tests, `npm audit`, and diff review. Run the de-slop pass. Resolve addressed CodeRabbit/GitHub review threads within the same review round. Only use `enabled_tests.txt` if producing a coverage report.
- At user-facing release, bump `package.json` and add the identical version key to `src/lib/changelog.ts`; update arena documentation. Mission/radio release switches can be disabled independently if production issues appear without deleting earned results or rolling back the additive database migration.

### Release checklist

- [x] Eight reachable street contacts offer all 24 missions with understandable unlocks.
- [x] Every mission has at least three meaningful steps, complete dialogue, contextual hints, a clear failure message and a cash reward.
- [x] All missions are finishable within their authored zone; timed rooms never offer an obviously unfinishable contract.
- [x] Wallet, earned cash, score and saved leaderboard agree; reconnect/retry cannot pay twice.
- [x] Slow travel feels closer, fast travel shows more road, and panning/aiming stay smooth.
- [x] Vehicles are measurably tougher without becoming invulnerable.
- [x] All 12 special-location bonuses last three times as long, with matching HUD timers and network expiration.
- [x] Hijacking an AI-driven car visibly opens its door, ejects its driver and seats the player consistently for all observers.
- [x] All 12 new radio pieces are real, reviewed audio files, including Dutch vocals, preaching, rants and four full summer trance tracks.
- [x] Gunshots are louder and radio slightly quieter, with clean mixing and ducking recovery to the reduced radio level.
- [x] Desktop, emulated phone and TV/controller browser flows pass the automated checks described above; production build, typecheck, lint (two pre-existing warnings), the full unit test suite and 21 database integration tests pass. Full npm audit reports zero vulnerabilities.
