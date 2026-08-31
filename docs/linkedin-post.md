# LinkedIn post — RVMJ

Nobody wins at mahjong. Everyone just remembers winning.

My friends and I have played for years. The scores lived on scraps of paper, or in
nobody's head at all. After months of play, the question "who is actually up?" had no
answer.

So I built RVMJ — a permanent leaderboard for our table.

Four NFC stickers sit on the sides of the mahjong table. You tap your phone on the
sticker at your seat, and the app puts you in that seat. Four taps and the game is on.

The interesting part isn't the tapping. It's what makes the numbers trustworthy.

Every game ends as four scores that sum to zero. That constraint is the entire security
model. To inflate your own result, you need three other people at the table to claim the
matching losses. Cheating stops being a technical problem and becomes a social one —
which is exactly where it belongs among friends.

A few decisions I'd defend at length:

→ Points, not dollars. What a point is worth stays a private arrangement between players.

→ House rules are copied onto each game, not referenced. A game played in March is scored
by March's rules forever, even after we change them.

→ Score movements are stored, never recomputed. Fixing a bug in the scoring engine can't
quietly rewrite two months of leaderboard history.

→ NFC is convenience, not security. A sticker is a static tag — anyone can read the URL
off it. Every permission is enforced server-side, and tag verification is isolated so a
cryptographic tag can drop in later.

Most tables settle each hand with physical chips, so the app stays silent during play. At
the end, everyone counts their chips by denomination and the app checks conservation:
40 × $1, 36 × $10, 16 × $50, 4 × $100 across the table. If the count doesn't conserve,
nothing is recorded — and it tells you which denomination is off.

The scoring engine has exactly one law: every possible event, under any house rules,
settles to zero. It's enforced as a property test — thousands of randomly generated rule
configurations and game events per run, all checking that one invariant. The difference
matters. Not "I tested the cases I thought of," but "I couldn't find a case that breaks
it."

Next.js, Supabase, and NTAG213 stickers that cost about as much as a round of drinks.

Now we know who's up. It isn't who anyone thought.

#SoftwareEngineering #SideProject #TypeScript #NFC #Mahjong
