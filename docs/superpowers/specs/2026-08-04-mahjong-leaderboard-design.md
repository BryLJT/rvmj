# RVMJ — Mahjong Leaderboard: Design Spec

**Date:** 2026-08-04 · **Revised 2026-08-07** (chip mode, standard chip set with a 400-point stack, three-way shooter — after Bryan's field session revealed physical chips at the table)
**Status:** Design approved by Bryan. Build in progress on `feat/v1` (plan tasks 1-6 done pre-revision).
**Author:** Alfred, from brainstorming sessions with Bryan Lim

---

## 1. What this is

A web app that records mahjong games and keeps a permanent leaderboard.

NFC stickers sit on the four sides of a mahjong table. Players tap their phone on the sticker at their seat, which opens the app and assigns them that seat. Once four people have tapped, they play. The game runs in one of **two modes**, chosen at start:

- **Chip mode** — the table settles every hand physically with the standard chip set (§6.7). The app stays out of the way until the end, when each player's chips are counted per denomination; the app derives net results and updates the leaderboard. Near-zero friction; the default for tables with chips.
- **App mode** — the app is the scorekeeper: each hand is recorded as it finishes and the server calculates the point movements from the house rules (§6). For tables without chips, and for the richest stats.

Either way, every game ends as four net results in points that sum to zero, and the boards never care which mode produced them.

**The core problem it solves:** mahjong scores are currently tracked on paper or not at all, so nobody knows who is actually up over months of play.

---

## 2. Glossary

Terms used throughout. Included because the rules engine is the bulk of this design and it cannot be read without them.

| Term | Meaning |
|---|---|
| **Tai** | The scoring unit of a hand. A hand is worth some number of tai, which converts to points. |
| **Base** | The point value of a hand's tai, read off the tai-to-points scale. |
| **Shooter** | A three-way rule setting for discard wins. OFF: everyone pays, discarder double. FULL: the discarder funds the whole payout alone. HALF: the discarder pays only their own doubled share and the winner takes half. |
| **Chip mode / App mode** | The two per-game modes. Chip mode: the table settles physically with the standard chip set and the app records only end-of-game counts. App mode: the app records each hand and calculates all movements. |
| **Standard chip set** | The fixed per-player composition (§6.7): 10×$1 + 9×$10 + 4×$50 + 1×$100 = 400 points, chip worth = printed number. |
| **Self-draw** | Winning on a tile you drew yourself rather than one someone discarded. |
| **Kong** | Four identical tiles. Concealed if you drew all four. Exposed if completed off a discard. Added if you drew the fourth and added it to a pung already showing. |
| **Animals** | Four bonus tiles forming two pairs: cat with mouse, rooster with centipede. |
| **Flowers** | Bonus tiles numbered 1 to 4 in two sets. A player's own flower is the one matching their seat number. A pair is both copies of the same number. |
| **Pair** | Both halves of an animal pairing, or both copies of one flower number. |
| **Forming** | A game that has been opened but has not yet reached four players. |
| **Void** | Reversing a recorded hand without deleting it. |

---

## 3. Scope

### In scope for version one

- NFC tap to join, with automatic seat assignment
- Google sign-in, required for all four players
- **Two game modes, chosen per game at start** (added 2026-08-07): chip mode (end-of-game per-denomination chip counts) and app mode (per-hand recording with the server calculating all point movements)
- The standard chip set page (§6.7): the official set for table setup, and the data behind chip-mode entry
- Per-game rule presets owned by user accounts (app mode)
- Bonus event recording for animal pairs, flower pairs, and kongs (app mode)
- Three-way shooter: off / half / full (added 2026-08-07)
- Three leaderboards: Lifetime, Form, Skill
- A notable-hands catalogue for the Skill board — loggable in both modes
- Telegram alerting for should-never-happen failures

### Explicitly out of scope for version one

Each of these is a decision, not an oversight. All can be added later without disturbing the model.

| Deferred | Why it can wait |
|---|---|
| Dealer and wind tracking | Bryan's table gives the dealer no special payment. Seat data is recorded anyway so this can be added retroactively. |
| Liability rules (feeding animals, kongs, flowers) | Isolated additions to the funding step. |
| Foreign flower pairs paying | Bryan needs to check this rule with his group. Isolated side payment. |
| Rebuy handling in chip mode | Bryan is researching how groups actually handle chips running out (he has never seen it). Until decided: a failed conservation check means a miscount — recount. |
| Editing a hand in place | Void and re-record covers it. |
| Guests without Google accounts | The leaderboard is the point of the app. |
| Three-player mahjong | Different rules entirely. |
| Dollar values displayed alongside points | Points are the unit of record; dollars are a private arrangement. |
| Private or per-group leaderboards | No group concept exists by design. |
| Admin UI (table creation, quarantine surgery) | Bryan operates via the Supabase dashboard. Rarest actions in the system. |

---

## 4. Architecture

### Stack

- **Next.js** deployed on **Vercel**: serves the pages and runs the rules engine
- **Supabase**: Postgres database, Google authentication, and live updates
- **NTAG213 NFC stickers**: cheap standard tags, four per table

Chosen over a Vercel-only stack and a Cloudflare Workers stack because Supabase supplies database, authentication, and realtime as one service, and because the combination is well documented enough for AI-assisted building to go smoothly.

### Shape

```
  Phone                    Vercel                    Supabase
 ┌──────┐              ┌─────────────┐            ┌──────────────┐
 │ tap  │ ──URL──────▶ │  pages +    │ ──────────▶│  database    │
 │      │              │  rules      │            │  auth        │
 │      │ ◀────────────│  engine     │◀───────────│  realtime    │
 └──────┘   updates    └─────────────┘            └──────────────┘
```

### The rules engine runs on the server

The phone reports *what happened*. The server decides *what it cost*. No point movement is ever calculated in the browser.

This is both a correctness property and a security one. A client-side calculation could be tampered with by whoever holds the phone. Server-side, the phone can misreport a hand, but it cannot misreport the arithmetic.

The engine is a **pure function**: given a winner, a win type, a discarder, a tai count, bonus events, and a rules config, it returns the four point movements. It touches no database, no clock, no network. This makes it exhaustively testable without any infrastructure.

---

## 5. Data model

Nine entities.

| Entity | Holds | Notes |
|---|---|---|
| **Players** | Display name, Google account link | One account, one identity, forever |
| **Tables** | The code burned into a tag set, optional label | A new table means four fresh tags with a new code |
| **Presets** | A named rule set, owned by a player | Two to five per user, expected |
| **Games** | Table, **mode (chips / app)**, start and end time, status, **a full copy of the rules used** | The rules copy is what keeps history honest; mode is snapshotted like everything else |
| **Game players** | Which player, which game, which seat, final total, **chip counts per denomination (chip mode only)** | Seat recorded even though unused in v1. `final_total` is the universal result both modes write |
| **Hands** | Game, sequence number, recorded by, voided flag | A container for scoring events |
| **Scoring events** | Belongs to a hand. Type, participants, tai, notable hand | Zero or more per hand |
| **Point movements** | Per event, per player, the signed point change | The ledger |
| **Notable hands** | Catalogue: name, local name, rarity | Editable data, not code |

### Two decisions worth defending

**The rules are copied onto each game, not referenced.**

Rules vary between games. If a game merely pointed at a preset, editing that preset in January would silently rescore every game played under it. Copying the whole rule set onto the game record freezes it. A game from March scores by March's rules, permanently.

**Both what happened and what it cost are stored.**

Point movements could be recomputed from hands plus rules on demand. They must not be. If they were, every fix to the rules engine would silently rewrite the entire history of the leaderboard, and nobody would notice.

Storing both also makes failures diagnosable. Recomputing movements from hands and diffing against what is on record points straight at any corrupted entry. With only one of the two stored, that comparison is impossible.

### A hand is a container of scoring events, not a record with a winner

The naive model gives a hand one winner and one settlement. That model cannot represent:

- A washed-out hand where animal pairs still paid out
- A hand where a losing player gained points from a kong

So a hand holds a **list** of scoring events. One may be a win. Others may be bonuses. A washed-out hand simply has no win event.

```
Hand 7
├── Event: Ah Seng completes cat + mouse pair (drawn)   → +3 to Ah Seng
├── Event: Bryan makes a concealed kong                 → +6 to Bryan
└── Event: Ah Beng wins, 4 tai, off Ah Seng's discard   → +32 to Ah Beng
```

Every event balances to zero independently, so any sum of events balances too.

(Hands, scoring events, and point movements exist only for **app-mode** games. A chip-mode game records no hands — its whole story is the four counted stacks at the end, stored on the game players. Both modes converge on the same output: four `final_total` net results summing to zero. Everything downstream — boards, history, stats — reads that field and never cares which mode produced it. The one exception is notable hands: in chip mode a notable win is logged as a standalone glory event with no movements attached.)

---

## 6. The rules engine

All values below are Bryan's table defaults, confirmed 2026-08-04; shooter widened to three-way and the display defaults aligned to the standard chip set (§6.7) on 2026-08-07. Every value is editable per preset.

The point unit is anchored the way Mahjong Leh anchors its credits: **denominate in the smallest payment, not in a round starting number.** 1 point = the smallest chip = the $1 chip (Bryan's mapping, confirmed 2026-08-07: the chip is worth its printed number). Every payment the engine can produce is an integer number of points, so any amount the rules can name is physically payable in chips. (Mahjong Leh's published payouts are this exact structure at a ×10 cosmetic scale: their 1-tai discard win is 10+10+20 = 40 credits where ours is 1+1+2 = 4 points.)

### 6.1 Scale settings

| Setting | Default |
|---|---|
| Tai to points | Doubling: 1 tai = 1, 2 = 2, 3 = 4, 4 = 8, 5 = 16 |
| Minimum tai to win | 1 |
| Tai cap | 5 |
| Shooter | Three-way, per game: **off / half / full** |
| Starting display total | 400 (= the chip-mode starting stack) |
| Bust line | −1200 (displayed) |

### 6.2 Win settlement

*Base* is the point value of the hand's tai, after clamping to the cap.

| Situation | Who funds it | Winner receives |
|---|---|---|
| Discard, shooter OFF | Discarder pays 2×, other two pay 1× each | 4× base |
| Discard, shooter FULL | Discarder pays the whole 4× | 4× base |
| Discard, shooter HALF | Discarder pays only their own 2×; other two pay nothing | **2× base** |
| Self-draw | All three pay 2× each (any shooter setting) | 6× base |

Structure note: OFF and FULL share an invariant — shooter changes **who funds** a discard win, never what the winner receives. **HALF breaks that invariant deliberately** (confirmed by Bryan 2026-08-07, played by some of his groups): the other two players are protected entirely, so the winner's take drops to half. Self-draw is unaffected by the shooter setting in all three modes.

Worked example, 4 tai, base 8:

| Situation | Discarder | Each other loser | Winner |
|---|---|---|---|
| Discard, shooter OFF | −16 | −8 | +32 |
| Discard, shooter FULL | −32 | 0 | +32 |
| Discard, shooter HALF | −16 | 0 | +16 |
| Self-draw | n/a | −16 | +48 |

### 6.3 Bonus events

Bonus payouts are **flat points**, independent of the tai scale — Bryan's rule "2 or 1 of the lowest value coin": 2 or 1 points, i.e. two or one $1 chips. A kong pays the same whether the group is on a doubling or flat tai scale.

Eligibility and amount are separate from funding.

**Amount** is set by the tile's status:

| Event | Amount per paying player |
|---|---|
| Own pair complete at the deal | 2 (two $1 chips) |
| Own pair completed during play | 1 (one $1 chip) |
| Concealed kong | 2 |
| Exposed kong | 1 |
| Added kong | 1 |

(For reference: Mahjong Leh pays its bonuses at double this magnitude relative to tai — their exposed gang is 2 tai-units, ours is 1. Same 1:2 normal/hidden ratio. Bryan's table rules govern; the difference is one preset field if anyone ever wants Mahjong Leh parity.)

**Funding** is set by whether a discarder exists, then by the shooter setting:

- No discarder (self-drawn): everyone pays. Shooter setting irrelevant.
- Discarder exists, shooter FULL: that player funds the whole amount.
- Discarder exists, shooter OFF or HALF: everyone pays. (⚠️ The HALF behaviour for exposed kongs is an ASSUMPTION — Bryan described half-shooter for wins only. Verify with the group alongside the rebuy research; candidates are "everyone pays" (assumed) or "discarder pays 1, others nothing, beneficiary gets 1".)

**Critical distinction:** *exposed* and *has a discarder* are not the same flag. An added kong is exposed (pays 10) but self-drawn (everyone funds it). Treating these as one flag produces silently wrong results.

**Animals and flowers can never be thrown.** They only come off the wall. So they are always self-drawn, and everyone always funds them regardless of the shooter setting. Shooter only ever bites on kongs and wins.

Resulting table:

| Event | Beneficiary gets | Who funds it |
|---|---|---|
| Own pair, complete at the deal | +6 | 2 from each of three |
| Own pair, completed during play | +3 | 1 from each of three |
| Concealed kong | +6 | 2 from each of three |
| Added kong (drew it yourself) | +3 | 1 from each of three |
| Exposed kong off a discard | +3 | Shooter FULL: discarder pays 3. OFF/HALF: 1 from each |

### 6.4 Pair eligibility

- A **pair** is both halves of an animal pairing (cat with mouse, rooster with centipede), or both copies of one flower number.
- **A lone tile pays nothing.** A cat without a mouse scores zero no matter when it arrived.
- Flower pairs must match the player's **own seat number**.
- Pairs pay independently. Both animal pairs in one hand pays twice.
- The recorded event is **pair completion**, not tile appearance. Drawing a cat is a non-event. The app only hears about a pair completing, which keeps input light.

### 6.5 Draws

A washed-out hand moves no points from a win. Bonus events recorded during that hand still stand.

### 6.6 Display totals and the bust line

Internally the ledger is a sum of movements and nothing else. For display, each player's in-game total starts at **400** — the value of the physical starting stack — so a player who is up 120 reads 520 and a player who is down 80 reads 320. Cosmetic in app mode; in chip mode it is literally the chips in front of you.

The **bust line** is −1200 on the displayed total (a fall of four stacks). It is **not a payment limiter**. Clamping a payment at the floor would break zero-sum: the winner would receive less than the rules dictate, or the other losers would pay more. Hands always settle in full.

Instead, when a player's total reaches the bust line, the app marks them busted and prompts the table to end the game. The humans decide, consistent with the rest of the design. Both values are per-preset settings. (App mode only — in chip mode the physical stack is its own limit, and Bryan reports chips never actually run out; see the rebuy KIV in §3.)

### 6.7 The standard chip set

Bryan's standardisation rule (2026-08-07): every table uses the same chip composition, so counts are comparable and the app can do per-denomination arithmetic. The app displays this set on a **rule page** for table setup, and chip-mode entry is denominated in it.

| Chip (printed face) | Worth in points | Qty per player | Subtotal |
|---|---|---|---|
| $1 | 1 | 10 | 10 |
| $10 | 10 | 9 | 90 |
| $50 | 50 | 4 | 200 |
| $100 | 100 | 1 | 100 |
| **Stack** | | **24 chips** | **400** |

Conversion rule: **the chip is worth its printed number** ($50 chip = 50 points — nothing to remember; confirmed by Bryan 2026-08-07, "stack 400"). The ratio between denominations (1 : 10 : 50 : 100) is exact, all values are integers, and the whole-table totals are fixed: 40 × $1, 36 × $10, 16 × $50, 4 × $100 = **1600 points on the table**, every game.

Why the smallest chip must be worth 1 point: the tai scale pays 1 point on the cheapest hand (1× base at 1 tai), so a smallest chip worth more than 1 could not physically settle it. With $1 = 1 point, every amount the rules can name is payable in chips with no change-making deadlock. The chip set and the tai scale speak the same language by construction.

The 1000-point round number from the original design was dropped: with Bryan's fixed quantities and exact ratio, integer stacks come only in multiples of 400. Mahjong Leh resolves the same tension the same way — the ledger is anchored to the smallest payment, and the starting total is whatever the set sums to.

---

## 7. The NFC gate

### What is achievable, stated plainly

A standard NFC sticker holds a URL. Any phone can read it. Once tapped, that URL is in the reader's browser history and can be bookmarked or shared. **The tag delivers a URL; it does not guard one.**

The gate therefore cannot protect the leaderboard from a determined faker, who could buy blank tags and burn their own table code. What it can do is prevent casual access, assign seats automatically, and make fabrication tedious enough that nobody bothers.

The leaderboard's real protection is that a game requires four distinct Google accounts on four distinct seats tapping within a short window.

### Chosen approach

**Cheap NTAG213 tags plus join windows.** Each tag holds a table code, a seat, and a long random secret.

The secret alone grants nothing. It permits a **join**, and a join is accepted only when a game at that table is currently open or was started within the last few minutes. A bookmarked URL opened at 3am finds nothing to join, and starting a game requires three other people tapping three other seats.

Bryan's call, on the basis that he trusts the people he plays with.

### Table provisioning (manual, by design)

There is no in-app flow for creating a table. Bryan is the operator:

1. Create the table row in the **Supabase dashboard**, which generates the table code and the four seat secrets.
2. Burn each secret's URL onto an NTAG213 sticker with a free phone app (e.g. NFC Tools). About a minute per tag.
3. Stick the four tags on the four sides of the table.

This happens perhaps twice a year. Building UI for the rarest action in the system is deliberately skipped.

### Upgrade path

Tag verification lives behind **a single function**. The rest of the app asks "was this a valid tap?" and receives a yes or no.

If cheap tags ever prove insufficient, swapping to NTAG 424 DNA tags (which generate a fresh cryptographic code and an incrementing counter on every tap, making replay impossible) means rewriting that one function and buying new tags. Nothing else changes.

---

## 8. Flows

### 8.1 Starting a game

1. First player taps their seat tag.
2. Browser opens with table code, seat, and secret.
3. Server validates the secret.
4. Player signs in with Google. **Sign-in is required; there is no guest mode.**
5. No open game at this table, so theirs becomes a **forming** game. They pick the **mode — Chips or App scorekeeper** — then (app mode) select a preset or configure rules on the fly. Chip mode needs no rules config; the standard chip set (§6.7) is displayed instead.
6. The other three tap their own seats and join the same forming game.
7. At four players, anyone can press **Start**.
8. All four screens display the mode and (app mode) the rules in force before the first hand.

Step 8 matters: objections happen while nothing is at stake.

**Sessions persist; sign-in is first-visit-only.** Supabase Auth issues a session cookie whose refresh token never expires by default (single-use, rotated on each refresh — verified against the Supabase docs 2026-08-04). A player signs in with Google once per phone, ever. The weekly experience is tap → already authenticated → straight into the seat. Step 4 only exists on a first visit or a new phone. No session-lifetime configuration is needed; the default is already indefinite, and the Pro-plan session limits (time-box, inactivity timeout) exist only to make sessions shorter.

Lost-phone mitigation: sessions can be revoked server-side from the Supabase dashboard.

**Caveat:** persistence depends on the tap opening the phone's real browser, where the cookie lives. If an NFC handler opens an in-app browser instead, the player looks logged out. Standard iOS/Android behaviour opens Safari/Chrome, so this mostly just works — but it is the first thing to check if anyone reports repeated login prompts.

**Preset ownership.** Presets belong to user accounts, not tables, so they travel with a player. Whoever starts the game picks from theirs. After a game, any player can save that game's rules as a new preset of their own, so rule sets spread without administration.

**On-the-fly rules are safe.** Because rules snapshot onto the game regardless, an unsaved one-off rule set is preserved exactly as reliably as a saved preset. Saving is purely about not retyping it.

**UI note:** design for two to five presets as a short list of large buttons, not a dropdown.

### 8.2 Recording a hand (app mode only)

Anyone at the table can record. There is no designated scorer.

1. Tap **Record hand**.
2. **Any bonus events?** Usually none, so one tap to skip. If any: which pair or kong, whose, and dealt or drawn.
3. **Outcome:** win, or washed out.
4. If a win: who won, self-draw or discard, who discarded, how many tai. Optionally tag a notable hand.
5. **Preview** showing the four point movements.
6. Confirm.

The preview catches the common error, which is selecting the wrong player. Seeing a name against a number is far more legible than re-reading a selection.

### 8.3 No per-hand confirmation

An earlier draft required all four players to confirm each hand. **Rejected.** Four confirmations per hand would make this slower than paper, which is how apps like this die.

**The live update is the check.** A recorded hand appears on all four phones immediately with the movements spelled out. Four people looking at a wrong number will say so within seconds.

The general principle: visibility is cheaper than approval and usually as effective. Approval costs every user an action on every event, forever. Reach for it only when the people involved might not care. Here, they do.

### 8.4 Fixing a mistake

Any player can **void** a hand. The app does not delete it. It writes a reversing entry, marks the original voided, and hides it from the normal view.

Deleted rows leave a leaderboard nobody can reconcile. Reversed rows leave one that can always be explained.

### 8.5 Ending an app-mode game

1. Someone taps **End game**.
2. Confirmation screen showing final tallies for all four.
3. The app verifies the four totals sum to zero.
4. Game locks. Results feed lifetime statistics.

Ending remains reversible for about an hour, in case it is pressed by accident mid-game.

### 8.6 Ending a chip-mode game

The app has been silent since Start (bar any notable-hand taps). Now it earns its keep:

1. Someone taps **End game — count chips**.
2. For each player, enter chip counts **per denomination**: how many $1s, $10s, $50s, $100s. Counting stacks by denomination is easier and less error-prone than mental arithmetic; the app computes each total.
3. **Conservation check, two levels.** The grand total must equal 1600 points, and each denomination must conserve across the table (exactly 40 × $1, 36 × $10, 16 × $50, 4 × $100). The per-denomination check catches miscounts that happen to balance in total. A failure names the denomination that is off and asks for a recount — it is a miscount until proven otherwise (rebuys: KIV, §3).
4. All four screens show the four net results (counted stack − 400). Each player confirms.
5. Game locks. `final_total` written for all four. Results feed lifetime statistics.

One entry moment per session. This is the whole cost of chip mode, which is why it is the default for tables that have the set.

### 8.7 Notable hands in chip mode

When someone wins with a catalogue hand, anyone taps **Log notable hand**: which player, which hand. Five seconds, whole table watching — the social check at its strongest. Stored as a standalone glory event with no point movements. This is the only in-game interaction chip mode has.

---

## 9. Leaderboards

Three boards, all reading from the same underlying records. This is one dataset with three views, not three systems.

| Board | Ranks on | Measures | Fed by |
|---|---|---|---|
| **Lifetime** | Total accumulated points | The long grind | Both modes (`final_total`) |
| **Form** | Average points per hand, minimum 20 hands to qualify | Current standard of play | App-mode games only (chip games have no hand count) |
| **Skill** | Tai totals and notable-hand counts | How you win, not whether you won | Notable hands: both modes. Tai totals: app mode only |

**Why points are the unit.** Groups play at different stakes. Recording tai and points rather than dollars means a group playing two dollars a point and a group playing twenty cents produce identical records. What a point is worth is a private arrangement the app never stores.

**Why the Skill board exists separately.** Money records that you won. Tai records how. A player can win steadily with cheap hands and never do anything remarkable. The Skill board is where that distinction lives.

**Why Form has a qualifying threshold.** Ranking on a lifetime total partly measures attendance. Ranking on a rate without a minimum lets one lucky night top the board.

There is **no group concept**. Whoever taps in is who is playing, so the leaderboard is global across all users.

---

## 10. Error handling

### Edge cases

**Before the game starts**

| Case | Handling |
|---|---|
| Wrong seat tapped | Leave and re-tap while forming. Seats lock at start. |
| Seat already taken | Explicit message, no silent overwrite. |
| One account taps two seats | Rejected. One account, one seat. |
| Fifth person taps a full game | Rejected with a clear message. |
| Forming game never fills | Expires after 30 minutes. |

**During the game**

| Case | Handling |
|---|---|
| Phone dies or browser closes | Re-tap to rejoin. Score kept accruing. |
| Two people record simultaneously | Server assigns sequence numbers. Duplicate is visible on four screens and voidable. UI shows "X is recording" during the flow. |
| Network drops mid-record | Hand and its movements commit together or not at all. No partial state. |
| Tai above the cap | Clamped, and the app says so. Silent clamping destroys trust. |
| Tai below the minimum | Refused, with the reason shown. |
| Self-draw with a discarder selected | Prevented by the interface, not caught afterwards. |

**Ending**

| Case | Handling |
|---|---|
| Nobody presses End | Auto-ends and locks after 12 hours of silence, so an abandoned game does not block the table. (A silent chip-mode game that hits this limit expires without results — there are no counts to settle it with.) |
| Totals do not sum to zero (app mode) | See below. |
| Chip counts fail conservation (chip mode) | **User-facing, not a system failure**: the app names the denomination that is off and asks for a recount. Entry can be repeated freely until it balances; nothing commits until it does and all four confirm. Not a quarantine case — quarantine is for impossible states, a miscount is an expected one. |

### The zero-sum failure

This should be impossible. Every hand is checked before writing, and a game's total is the sum of its hands. A failure therefore means a bug, a partial write, or direct database tampering, never a user mistake. That shapes the response.

**Four layers:**

1. **Refuse at write time.** Unbalanced movements are never written.
2. **Enforce in the database.** Hand and movements write in a single transaction with a constraint checked at commit. Unbalanced writes roll back entirely. This is stronger than layer 1 because it covers code paths written later that bypass the application check.
3. **Verify at game end.** Recompute and compare. If this fires, layers 1 and 2 were somehow circumvented.
4. **Quarantine and alert.**

**When it fires:**

- **The players are not punished.** The game ends normally, they see their scores, they go home. Blocking a finished game helps nobody.
- **The game is quarantined.** Marked for review, excluded from lifetime statistics, with a plain banner on that game's card explaining it is being looked at.
- **Bryan is alerted by Telegram.** Not a log entry. An unread should-never-happen check is the same as no check.

**Recovery:** recompute the movements from the hands using that game's stored rules and diff against what is on record. The difference identifies the offending hand. Then either add a correcting entry and release the game, or void it.

**Operations:** all quarantine surgery — releasing a game, adding a correcting entry, voiding — happens through the Supabase dashboard with Bryan as the operator. There is no admin UI in version one; it is a v2 luxury for a failure mode that should never fire.

Layer 3 is a smoke detector, not a sprinkler. Its only job is to turn a silent problem into a loud one. Graceful recovery from an impossible state would mean the impossible state keeps happening and nobody ever finds out why.

**Optional:** a nightly job re-verifying every game in the ledger, catching anything that drifts after the fact.

### Alerting

**Channel:** a Telegram bot, direct chat only.

**Triggers:** zero-sum failures and engine crashes. Nothing routine. The moment an alert channel carries noise it gets ignored.

**Payload:** table, game time, size of the discrepancy, all four players' display names and emails, and a direct link to that game's scorecard (the normal game view any player can see — there is no separate admin view in version one).

**Note:** emails in the payload means personal data lands in Telegram history. Acceptable in a private chat with your own bot; not acceptable if ever pointed at a group.

**Security:** the bot token is a credential and belongs in a Vercel environment variable. It must never appear in the code or be committed. A token committed once persists in git history forever, and bots scan public repositories for exactly this. Same rule for Supabase keys.

---

## 11. Testing

### The rules engine

The engine is a pure function with no dependencies, which is what makes exhaustive testing cheap. No browser, no database, no logged-in user required.

**Worked examples.** Every row of the rules tables in section 6 becomes a test case. A concealed kong pays 6. A shooter-FULL discard at 4 tai makes one player pay 32. A shooter-HALF discard at 4 tai pays the winner only 16, funded by the discarder alone. A self-draw at 4 tai pays the winner 48.

**Chip-mode entry.** The conservation checker is pure arithmetic over the chip-set config — test grand-total balance, per-denomination balance, and the miscount case where the total balances but one denomination is off (must be rejected, naming the denomination).

**A law, not an example.** A property test throwing thousands of randomly generated valid hands at the engine, asserting one thing: the movements always sum to zero. This catches combinations neither Bryan nor Alfred thought to write down.

### Joining logic

Tested for races: two people claiming one seat, a fifth arrival, rejoining mid-game.

---

## 12. Open items

| Item | Owner | Notes |
|---|---|---|
| Foreign flower pairs rule | Bryan | Needs checking with his group. Whether holding another player's flower pair earns 1 from that player alone. |
| Rebuy practice in chip mode | Bryan | Researching with the players. He has never seen chips run out; until decided, a failed conservation check = miscount, recount. |
| Half-shooter × exposed kong | Bryan | §6.3 assumes everyone pays (HALF behaves like OFF for kong funding). Verify with the group. |

## 13. Decisions log

| Decision | Rationale |
|---|---|
| Points, not dollars, as the unit of record | Normalises across groups playing different stakes |
| No group entity | Bryan: rotating players, whoever taps is who plays |
| App calculates payments, not manual entry | Zero-sum guaranteed by construction; skill board comes free |
| Optional notable-hand tag, not full scoring breakdown | Decouples the score (exact, every hand) from the achievement (rare, for glory) |
| Rules snapshot onto each game | Rules vary per game; prevents silent rescoring of history |
| Point movements stored, not derived | Prevents silent rewriting; makes failures diagnosable |
| Hand as a container of events | The naive model cannot represent draws with bonus payouts |
| Cheap tags with isolated verification | Trusted group; upgrade path preserved behind one function |
| Sign-in required, no guests | The leaderboard is the point of the app |
| Visibility instead of per-hand approval | Approval friction would kill it; four people watching is the check |
| Server-side rules engine | Security, and it makes the engine trivially testable |
| Display starts at 400, bust line at −1200 displayed *(revised 2026-08-07 from 1000/−3000)* | The display IS the chip stack; bust is a prompt to end, never a payment clamp, so zero-sum survives |
| **Dual mode: chips or app scorekeeper, per game** *(2026-08-07)* | Bryan's field session found chips at the table — a physical ledger that settles every hand with zero taps. Chip mode records outcomes; app mode models rules. Same output either way: four `final_total`s summing to zero |
| **Standard chip set: $1/$10/$50/$100 worth 1/10/50/100 points, qty 10/9/4/1, stack 400** *(2026-08-07)* | Chip worth = printed number. Exact ratio + integers force stacks in multiples of 400; the 1000 target was aesthetic and dropped. Mahjong Leh research validated anchoring the ledger to the smallest payment |
| **Per-denomination chip entry + per-denomination conservation** *(2026-08-07)* | Counting stacks beats mental totals; denomination-level conservation (40/36/16/4) catches miscounts that balance in total |
| **Three-way shooter: off / half / full** *(2026-08-07)* | Bryan's groups play a half-shooter variant: discarder pays only their own 2×, winner takes 2× instead of 4×. Breaks the "shooter never changes the winner's take" invariant deliberately |
| Rebuy: KIV, conservation failure = recount *(2026-08-07)* | Bryan has never seen chips run out; researching group practice before designing a mechanism |
| Manual table provisioning via Supabase dashboard + NFC Tools | Happens ~twice a year; no UI for the rarest action |
| No admin UI; alerts link to the normal scorecard | Quarantine surgery via Supabase dashboard; admin UI is v2 |
