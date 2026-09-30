# Ideas backlog

Suggestions not built yet, kept for later. Pick one up only when asked.

Every idea has a short code, such as `M1`, so it can be referred to directly ("build M1"). When an idea is built, remove its entry but don't reuse its code.

## Novel features (suggested September 30, 2026)

These ideas were chosen for novelty. Each was checked against the closest existing tools (Chesstempo, chessgames.com, Play Grandmasters, ChessBase 18 Replay Training, Chessguessr and the Maia platform), and none of them offered it as of September 2026.

The ideas build on what sets this app apart: every move is judged both against history and against the engine, a private group races through the same hidden game, every browser runs an engine, and challenge moves are stored in detail. They also target its gaps: every matched move earns the same XP, a miss ends in a one-line correction, challenges need everyone online at once, and little brings players back between sessions.

Code letters: **M** changes how moves are guessed, **D** turns deviations into discoveries, **S** is social play and habits, **X** is a smaller extra.

| Code | Idea | In short | Effort |
|---|---|---|---|
| M1 | Probability chips | Spread chips over candidate moves instead of guessing one; scored with a proper scoring rule | Medium |
| M2 | Hidden gems and house players | Price each master move by how rare it is for humans at your rating; human-like bots fill challenges | Large |
| M3 | Time mirror | Your clock follows the master's real clock; compare your thinking time with theirs | Small |
| M4 | Plan match | Write your plan at turning points; an AI model grades it against what the master did | Medium |
| M5 | Attention map | Webcam gaze tracking shows where you looked versus where the master's move was | Large |
| D1 | Alternate history | Branch off at a deviation and play on against the historical opponent's strength; shared tree of branches | Medium |
| D2 | Book of improvements | Verified, credited record of moves that beat the master's move by engine verdict | Medium |
| S1 | History detective | Before the challenge reveal, guess the year and the players; the year is scored by distance | Small |
| S2 | AI storytelling | Quiz-show host lines, match reports and a weekly club newspaper, all from real data | Medium |
| S3 | Game portraits | Generative art drawn from each well-played game, collected in an album | Small |
| S4 | Clubmates as masters | Guess members' moves in their own imported online games; scouting mode | Medium |
| X1 | Buy hints with clock time | In challenges, pay clock seconds to learn which piece the master moved | Small |
| X2 | Crowd reveal | After a challenge, show how everyone's moves split at each position | Small |
| X3 | Ghost races | Race a recorded challenge run later, with its progress replayed live | Medium |
| X4 | Master affinity | Match rate per master shows whose thinking is closest to yours | Small |

Suggested order: M1 and S1 first, since they are clearly new and need no AI or new infrastructure. Then S2 followed by M4, which share the server-side AI setup. Then M2, the largest step, which also improves D1.

### M1. Probability chips

On each move the player spreads a few chips (say 10) over candidate moves, drawn as arrows on the board: for example 6 on a knight jump, 3 on a rook lift and 1 on a pawn push. The score depends on the share of chips on the master's move. Putting every chip on one move keeps today's single-guess flow.

- **Scoring rule:** it must be *proper*, meaning honest spreading earns the most on average. The quadratic (Brier) rule works: with p(m) the share of chips on move m, score = 2 * p(master's move) - sum over all moves of p(m)^2. A linear rule (points = share on the right move) is not proper: it always rewards putting every chip on the favourite, which makes chips pointless.
- **Why it's new:** every guess-the-move trainer checked accepts exactly one answer.
- **Training value:** builds Kotov's candidate-move habit and calibration (knowing how sure you are). It also separates "never considered the master's move" (no chips on it) from "considered and rejected it" (some chips), which today's records can't.
- **Fun:** in challenges every move becomes a bet, with visible all-in moments and comebacks.
- **Starting points:** react-chessboard 5 already supports drawn arrows (`allowDrawingArrows`, `onArrowsChange`). Put the scoring rule in `shared/` with tests, like `shared/elo.ts`. Solo moves go through `handleMove` in `src/hooks/useTrainingSession.ts`; challenge moves through `playMove` in `server/challenges.ts`, and `challenge_moves` would need a column for the chip spread. The move played on the board and analyzed by the engine is the one with the most chips.
- **Open question:** whether challenge ranking uses the chip score, accuracy, or both.

### M2. Hidden gems and house players

Open human-move models predict how often players of a given rating would choose each move in a position. Use one to price every master move by how hard it is for a human at the player's rating to find.

- **Hidden gems:** an obvious recapture that most players find pays little; a move almost nobody at the player's rating finds pays a lot and is celebrated as a gem. Crowd data can refine the price later ("only 3 of 41 members found this").
- **Why it's new:** Chesstempo gives partial credit by engine value, which measures how good a move is. This measures how hard it is for humans to find. Today XP is a flat 1 per matched move (`awardXp` in `server.ts`).
- **House players:** the same model can play as human-like bots at chosen ratings, filling challenges when few members are online. Bots with fixed ratings would also anchor the club's ELO to an outside scale; today a rating only means something relative to other members.
- **Model:** Maia-2 is MIT-licensed (https://github.com/CSSLab/maia2). Its authors' platform runs Maia in the browser with ONNX Runtime Web (https://github.com/csslab/maia-platform-frontend), much as this app runs Stockfish as WebAssembly. The newer Maia-3 is more accurate; check its license first.
- **Starting points:** follow the engine wrapper pattern in `src/clientStockfish.ts` (one lazily created worker, a queue, a result cache). Challenge players are trusted (see the README), so the model can run in each player's browser like the engine analysis. Bots in challenges need a new kind of player, since a player row without a user currently means a deleted account, and a browser to run them, such as the host's.
- **Also enables:** picking games whose predicted match rate suits the player, and a human-like opponent for D1.

### M3. Time mirror

Many modern PGNs record each player's remaining clock after every move as `[%clk h:mm:ss]` comments. In time-mirror mode, the player's clock at each move is set to what the master had before that move (the master's previous clock comment), so the player faces the master's time trouble at the same point in the game. Afterwards a chart overlays the player's thinking time and the master's, move by move. A "time sense" score, for example the correlation between the two, shows whether the player spends time where the master did, which is the skill of spotting critical moments.

- **Why it's new:** lichess and chess.com can replay a game at its real pace, but nothing found compares a trainee's thinking time with the master's.
- **Data:** lichess and chess.com downloads include clock comments; many classic collections don't. The master's thinking time for a move is their previous clock minus their clock after the move, plus the increment. For games without clocks, mark critical moves with the engine instead: positions where the best move is far better than the second best. That needs MultiPV 2, which `src/clientStockfish.ts` doesn't request yet.
- **Starting points:** the full PGN is stored in `games.pgn`, so clock comments survive import, and chess.js `getComments()` returns them with their positions. The clock lives in `src/hooks/useClock.ts`. Challenges already store `think_ms` per move; solo sessions don't record thinking time yet (`MoveRecord` in `src/hooks/useTrainingSession.ts`).

### M4. Plan match

At a few turning points per game, the session pauses and asks for the player's plan in a sentence or two, typed or spoken. An AI model compares the plan with what the master did over the next 8 to 12 plies and with the engine's main line, then replies briefly, for example "Same idea, a kingside pawn storm, but the master prepared it with Kh1 first." The game then continues and the player watches the master's plan unfold.

- **Why it's new:** grading free-text plans wasn't practical before language models; every trainer checked grades moves only.
- **Training value:** trains strategic thinking, not only move recall.
- **Grounding rule:** language models calculate chess unreliably, so never ask the model to analyze. Give it the facts (the master's next moves, the engine's evaluation and main line, and simple features computed in code such as captures, pawn moves and where pieces went) and ask it only to compare the plan with them.
- **Challenge variant:** everyone writes a plan at the same moment, and the plans are revealed side by side with the master's continuation.
- **Starting points:** a server endpoint that keeps the API key in an environment variable, with a per-user daily cap through `allowRequest` in `server/http.ts`. Turning points can come from a quick low-depth engine pass over the master's line at session start, picking positions where the evaluation shifts sharply over the next few moves. Speech input can use the browser's Web Speech API (Chrome and Edge).

### M5. Attention map (long shot)

With the webcam turned on by choice, the browser estimates where on the board the player looks while thinking. After a miss it can show, for example, that the player watched the kingside while the master's move was on the queenside. Over many games it reveals blind spots such as backward moves, the far flank or long diagonals.

- **Why it's new:** webcam gaze tracking for chess exists only in hobby prototypes, not in training products.
- **Limits:** accuracy is coarse, so work with board regions (flanks, quadrants), not single squares, and include a calibration step. The video never leaves the browser.
- **Starting points:** WebGazer.js, or MediaPipe Face Landmarker with iris landmarks. A cheap first step needs no webcam: log hovered squares and pieces picked up and put back, which react-chessboard reports (`onMouseOverSquare`, `onPieceDrag`).

### D1. Alternate history

Today a deviation stays on the board for 1.1 seconds, then the historical line is restored. Instead, offer to branch off: the game continues from the player's move against an engine opponent at the historical opponent's strength. When the branch ends, after a set number of moves or at a decisive evaluation, the verdict compares engine evaluations and says whether the player's version turned out better or worse than history.

- **Multiverse map:** every branch is saved, so each famous game grows a shared tree of everyone's alternate versions, colored by outcome ("the usual escape at move 17 fails in most branches").
- **Why it's new:** playing on against an engine from any position is common; a group's shared tree of alternate histories of real games, played against the historical opponent's strength, is not.
- **Club version:** members vote on one move a day in a famous game; a vote that differs from history starts a club branch that continues against the historical opponent.
- **Starting points:** the bundled Stockfish build supports the `UCI_LimitStrength` and `UCI_Elo` options. Ratings come from the PGN's `WhiteElo` and `BlackElo` headers when present (read them like `pgnHeader` in `server/pgnImport.ts`); older games need a default. The correction step to hook into is in `handleMove` in `src/hooks/useTrainingSession.ts`. Branches need a new table: game, starting ply, moves, final evaluation, player. M2's model would make the opponent play like a human.

### D2. Book of improvements

When a player's move differs from the master's and the engine rates it higher, that is an improvement on history. Record it permanently with the player's name.

- **Verification:** shallow searches often mistake a move for an improvement, so re-check candidates at high depth before confirming them. Idle browsers can do it, extending the way browsers already analyze for a challenge player who left (`helperTarget` and `storeAnalysis` in `server/challenges.ts`). This is about search depth, not cheating.
- **Rewards:** a personal book of improvements, a club hall of fame, and badges such as "Improved on a world champion" (badge definitions live in `shared/badges.ts`).
- **Gentler variant, the precedent check:** when other masters in the library played the player's deviation in the same position, say so ("two other games in the library continued this way"). Needs an index from positions (FEN without the move counters) to games, at least for the opening phase.
- **Why it's new:** tools show a trainee's accuracy next to the master's, but none turn outplaying a master into a verified, credited find.
- **Starting points:** challenge moves already store both centipawn losses (`cpl` and `original_cpl` in `challenge_moves`). Solo sessions compute the same per-move results in `src/views/TrainingView.tsx` but only send totals to `POST /api/stats`, so they would need to save per-move results.

### S1. History detective

Challenges hide the game until the results. Add a last round before the reveal: each player guesses the year on a slider and picks the two players from a few options. The year is scored by distance, like GeoGuessr, so being a decade off still earns points; the names score per correct pick.

- **Why it's new:** Chess Lessons Pro has a solo quiz for naming famous games, but no year scoring and no round inside a live race through a hidden game.
- **Value:** gives the reveal real stakes and builds a feel for how chess styles changed over time.
- **Starting points:** a player can guess as soon as they finish playing, which fills the wait for the others and for the analysis. The answers are in the `challenges` row (`game_date`, `game_white`, `game_black`); wrong options can come from other players in the library. Skip the year when the date is unknown (for example `????.??.??`). The score could add to XP or stand as a separate challenge score.

### S2. AI storytelling

An AI model turns data the server already has into short stories.

- **Quiz-show host:** during a challenge, short lines on streaks, lead changes and flag falls, shown as a ticker and optionally read aloud with the browser's speech synthesis. That needs no audio files, like the app's synthesized sounds, and the Sound switch should mute it too.
- **Match report:** after a challenge, a short recap of the race and some background on the revealed game.
- **Weekly club newspaper:** a home-page panel whose headlines come from the week's real events: improvements found (D2), big rating changes, new badges, streaks and rivalries.
- **Why it's new:** no chess app found writes news about a private group of players.
- **Rules:** during play, never hint at the hidden game: its identity and moves must not reach any prompt whose output players see before the reveal. Facts about members and results come only from the database. Background on a famous game may come from the model's knowledge but should stay brief and general, since details can be wrong.
- **Starting points:** events are in `rating_events`, `xp_events`, `user_badges` and the challenge tables; live delivery goes through `sendToUser` and `broadcast` in `server/realtime.ts`. Cost stays small: a few model calls per challenge and one per week.

### S3. Game portraits

Each game a player completes well, for example above a match-rate threshold, earns its portrait: generative art drawn from the game itself. Each piece's route across the board becomes a colored line, captures become bursts, and the final position anchors the picture. The same game always produces the same picture, and rarer frames mark stronger performances (match rate, gems from M2).

- **Album:** sorted by era, player and opening, which pulls players toward games they haven't tried. Portraits can be downloaded as images to share.
- **Why it's new:** chess games have been turned into art before, but no trainer found uses that art as a collectible reward.
- **Starting points:** plain SVG built from chess.js verbose history (`from` and `to` squares, tracking each piece's identity through its moves), with no AI and no running cost. Badges already use SVG assets and a celebration animation (`src/badges/BadgeCelebration.tsx`) that portraits could reuse.

### S4. Clubmates as masters

Members link their lichess or chess.com accounts, and the app imports their public games. A challenge's hidden game can then be a member's game: predict how your friend played, then guess whose game it was. A scouting mode does the same with an upcoming opponent's games before a club match.

- **Why it's new:** anyone can set up a friend's game for guessing on lichess by hand, but no trainer found makes friends the masters.
- **Rules:** opt-in per member. Keep these games in their own table, apart from the admin-curated library. Never pick a member's own game for a challenge they play in.
- **Starting points:** lichess `GET https://lichess.org/api/games/user/{username}` returns PGN (public, rate-limited); chess.com's published-data API lists archives at `https://api.chess.com/pub/player/{username}/games/archives`. The PGN parsing in `server/pgnImport.ts` can be reused, and challenges pick their game in `pickGame` in `server/challenges.ts`.

### X1. Buy hints with clock time

In a challenge, a player can give up some clock seconds to learn which piece the master moved (the from-square only). This adds a decision between time and information. The server deducts the time from `remaining_ms` in `challenge_players`, reschedules the flag timer (`scheduleFlag`), and sends the from-square of the current move only.

### X2. Crowd reveal

After a challenge completes, show how all players' moves split at each position, like a quiz answer chart ("3 of you played Rxd4, 1 found the master's Nf5"). Today each player only ever receives their own moves, even after the results (`snapshot` in `server/challenges.ts`). Sharing everyone's moves is fine once the challenge is complete.

### X3. Ghost races

Record each challenge run so friends can race it later, with its progress replayed live next to theirs, like a ghost car in a racing game. It helps a small group that is rarely online together. `challenge_moves` already stores each move's timing (`created_at`, `think_ms`).

### X4. Master affinity

A player's match rate per master shows whose thinking is closest to theirs. Recommend more of that master's games, or games by the opposite style to broaden. `training_sessions` has `game_id` and `side`, which give the master's name from `games`.

### Left out because they already exist

Checked and dropped, so they don't come back as new ideas:

- Hints while guessing, and calculating without seeing the board: ChessBase 18 Replay Training.
- Partial credit by engine value, and a guess-the-move rating: Chesstempo.
- Wordle-style guessing of the next moves of a game: Chessguessr.
- Hand-and-brain with an AI partner, and guessing whether a human or a bot played: the Maia platform.
- Spaced review of past mistakes: Chessable.

### References

- Chesstempo Guess The Move: https://chesstempo.com/guess-the-move/
- chessgames.com Guess-the-Move: https://www.chessgames.com/perl/guessthemove
- Play Grandmasters: https://playgrandmasters.com/
- ChessBase 18 Replay Training: https://en.chessbase.com/post/chessbase-18-beginner-s-tips-part-22-maximum-training-effect-with-the-replay-training-power-tool-part-2
- Chessguessr: https://www.chessguessr.com/
- Maia platform overview: https://chessdrive.io/blog/maia-chess
- Maia-2: https://github.com/CSSLab/maia2
- Maia platform frontend: https://github.com/csslab/maia-platform-frontend
- Chess Lessons Pro, Guess the game: https://www.chesslessonspro.com/guess-the-game/
- Chess eye-tracking prototype: https://github.com/ryan1woodard/ChessEyeTrackerProjectCapstone
- Lichess real-time replay: https://lichess.org/forum/general-chess-discussion/how-precise-is-the-realtime-playback-feature
