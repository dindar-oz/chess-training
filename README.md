# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:


## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

# Chess Training App

Browser-based training against the main line of a strong player's game.

## Run

```powershell
npm install
npm run dev
```

Open the local Vite URL, then select White or Black and play the recorded game.

The backend must also be running:

```powershell
npm run server
```

## Home page

After logging in you land on a dashboard that fits a PC window without scrolling: one large illustrated button for each section (Game Library, Challenges, My Statistics, Awards, Leaderboard, and Admin Panel for admins). The section pages keep their tab row, with a **Home** tab to get back.

## Accounts and privacy

Create an account or log in from the app. Passwords are hashed server-side with Node `scrypt`, and the session uses an HTTP-only cookie. The game database is shared between users, but training statistics are stored per user in SQLite and are never returned to another account.

## Forgotten passwords

Accounts have no email address, so resets are approved by an admin. On the login screen, **Forgot my password** sends a request for a username (the reply is the same whether or not the account exists). Online admins get a notice, and the Admin tab lists pending requests; **Create reset link** (also available as **Reset password** for any user) produces a one-time link valid for 24 hours, which the admin passes to the user however they like. Opening it lets the user choose a new password, after which every existing sign-in for that account is logged out. Links are stored only as hashes and a newer link replaces an older unused one. Admins set by `ADMIN_USERNAMES` cannot be reset from the panel.

## Time controls

Before choosing a side, pick a time control: Untimed (default), a preset such as 10+0 or 15+10, or a custom base (1-180 minutes) plus increment (0-60 seconds). Only your clock runs; the historical opponent's moves are instant, the clock pauses while a deviation is corrected, and each of your moves adds the increment. If your flag falls, the session ends and the moves you played are analyzed. A timed-out session earns XP for matched moves only, without the completion or perfect-game bonus.

## Challenges

The **Challenges** page opens on the lobby, a live list of open challenges, with two buttons beside it for creating one. Both open a dialog where you choose a side (White, Black or Random) and a time control:

- **Challenge by invitation**: tick online players to invite and send. Invitees get a pop-up on any screen and can accept or decline.
- **Open challenge**: choose the maximum number of players (2-10, you included). The challenge appears in everyone's lobby, and anyone can join it with one click while a seat is free.

In the waiting room the host can also **add practice bots**, at three levels: Weak, Medium and Strong play the master's move about 40%, 65% and 85% of the time. When a bot strays it plays the engine's best move if the server has already searched the position, and the weak bot sometimes plays a random legal move instead. A bot takes a seat at once, plays on the server with its own clock (thinking a few seconds per move), and can be removed like a player. Bots are placed in the standings but never rated, and nobody is rated against them; a challenge with only one person (against bots) is unrated. The rules live in `shared/bots.ts` with tests.

Either way the creator starts once at least one player (or bot) has accepted or joined (invitations still open at that moment expire), and can remove a player from the waiting room before the start; a removed player can't rejoin that challenge. A player is in one challenge at a time: someone in a waiting room who joins an open challenge or accepts an invitation is asked to confirm, then leaves their current challenge, and a host who does so cancels theirs. Players in a running game can't join another. The lobby stays visible below the waiting room for that purpose. Your past challenges are listed under the lobby.

At the start the server picks a random game from the library (preferring games of 20+ plies). Everyone plays the same side with the same clock after a 3-second countdown. To keep it fair:

- The game's identity and moves are never sent to players while it is running; each player only receives the position they must move in. The game is revealed on the results screen.
- The server keeps every clock: it charges thinking time, adds the increment, pauses 1.1 s after a deviation while the line is restored, and flags players whose time runs out (also after a server restart; clocks keep running while the server is down).
- Players see each other's progress and clocks, never their moves.

**The server scores every move** with its own Stockfish (see [Challenge scoring](#challenge-scoring-on-the-server)), so every player is judged by the same engine at the same depth, whatever their browser can run. It starts on the game's positions as soon as the challenge starts and searches each move a player makes as it comes in, so scoring mostly keeps pace with the game. Scores stay hidden from a player until they have finished. Once everyone has finished, timed out or resigned, the waiting screen shows the scoring progress, and results arrive as soon as the last move is scored.

A player who has finished (or timed out or resigned) doesn't have to wait: **Leave the challenge** on the waiting screen frees them to train or join another challenge (joining or creating one also leaves it). The challenge then shows as *Results pending* under Past challenges, where it can be opened to follow its progress; the game stays secret until the results are in. When they are, every player who isn't already looking at them gets a notice on whatever page they are on, with their place, accuracy and rating change and a **See results** button; anyone offline then gets it at their next visit, until they have seen the results or dismissed the notice. The server then ranks players (finishers above timeouts and resignations, then by accuracy), updates ELO, and records each player's challenge as a training session with XP. A challenge whose moves still aren't all scored 3 hours after everyone finished is voided (the engine must be failing), and nobody's rating changes. Lobbies are cancelled if the creator is offline for over a minute or nobody starts them within 30 minutes.

### Challenge chat

Players in a challenge (the host and everyone who accepted) share a simple message box from the waiting room through the results. Messages are relayed live and are never stored, on the server or in the browser, so reloading the page starts with an empty chat. Any player can mute the chat for themselves, and the host can mute it for everyone, which stops all players from sending until it is unmuted.

## ELO rating

Every player starts at 1200. Only challenges change the rating; solo training earns XP but never ELO. Bots are left out of the rating, so a challenge needs at least two people to be rated. In a challenge, every pair of people counts as one game: a player who finished beats anyone who timed out or left, otherwise the higher accuracy wins, and accuracies less than 1% apart are a draw. K is 32 divided by (players - 1), so a large challenge moves ratings about as much as a duel. Ratings never fall below 100. The math lives in `shared/elo.ts`; run its tests with `npm test`.

## Live updates

Each logged-in tab keeps a Server-Sent Events stream open at `GET /api/events` (at most 5 per user). It drives the online count in the header and the online dots on the leaderboard, and carries challenge invitations, lobby updates and clocks. A user is online while at least one tab is connected. The server sends a heartbeat every 25 seconds, which also closes streams whose session expired or was revoked; logging out, disabling or deleting a user closes their streams immediately. Presence lives in server memory, so run a single server instance.

Each build gets a unique id (`dist/version.json`, also compiled into the client). After a deploy every open page reconnects, the server's first event reports its build, and an outdated page reloads itself if it is on a safe screen (no training session opened and no active challenge); otherwise it shows a "new version available" banner with a Reload button and never interrupts a game. Behind a reverse proxy, disable response buffering for `/api/events` (the server already sends `X-Accel-Buffering: no` for nginx).

## Administrators

Only admins can import games into the shared library or delete them. A PGN upload can be up to 50 MB, and the library holds at most 20,000 games; once it is full, the rest of an upload is reported as not imported. Files over 1 MB upload directly without a preview. Imports run in the background on the server in short slices so the site (and running challenges) stay responsive; progress is shown live in the Admin tab, which you can leave and return to. Unreadable games and duplicates are skipped and counted, and only one import runs at a time. Admins also manage users in the **Admin** tab: promote to admin or demote, disable (logs the user out and blocks login), re-enable, or delete (permanently removes the account with its training history and XP).

The first admin comes from the `ADMIN_USERNAMES` environment variable (comma-separated, case-insensitive). Listed users are promoted when the server starts, so:

1. Register the account in the app first.
2. Restart the server with the variable set. No administrator rights are needed; it only applies to that terminal session:

   ```powershell
   $env:ADMIN_USERNAMES="yourname"; npm run server
   ```

   With Docker: `docker run -e ADMIN_USERNAMES=yourname ...`

Registering first matters: promotion by name would otherwise hand admin rights to whoever registers that name. Admins listed in `ADMIN_USERNAMES` show as locked in the panel and can't be demoted, disabled or deleted there. Admins also can't change their own account, so at least one admin always remains.

## Badges

The **Awards** tab shows every badge, earned or still locked. Each badge pays XP once, when it is earned, and its image shows how much:

| Badge | How to earn it | XP |
|---|---|---|
| **1st Game Completed** | Finish your first game, in training or in a challenge. | 10 |
| **First Challenge** | Play a challenge through to the results (running out of time counts; resigning doesn't). | 20 |
| **Hat Trick**, **On Fire**, **Master Mind** | Match 3, 5 or 10 of the master's moves in a row within one challenge. | 15, 30, 75 |
| **Improver** | Play a move the engine rates better than the master's. | 40 |
| **History Rewriter** | Do that 3 times in one challenge. | 120 |
| **Outplayed the Master** | Finish a challenge with an accuracy at least 1 point above the master's on the same moves. | 100 |
| **Steady Hand** | Finish a challenge without a blunder (??). | 50 |
| **Flawless** | Finish a challenge without a mistake (?) or a blunder. | 150 |
| **Sharp Eye** | Find 3 only moves (!) in one challenge. | 100 |

The last six are engine badges: they count only in challenges scored at depth 21 or more (the server's default depth is 24), and "finish" means playing every move on time. They are judged as on lichess, by winning chances from -1 (lost) to 1 (won): a move that loses 0.2 of them is a mistake and 0.3 a blunder, so dropping from +9 to +6 in a won position is neither. An only move is the engine's best move when the second-best move loses at least 0.2, and a move beats the master's when it keeps at least 0.05 more (so engine noise between equal moves doesn't count). For only moves the server searches the two best moves of every position. The rules live in `shared/badges.ts` with tests.

The server awards badges and remembers them per account. A new badge is celebrated once, with an animation and a fanfare: as a small corner card that doesn't block the board while your challenge clock is running, and as a full-screen moment otherwise. A badge earned while no page was open is celebrated at your next visit. Badges for play from before badges existed are granted automatically when the server starts, and XP for badges earned before badges paid XP is paid once at startup. Engine badges aren't granted for old challenges, which didn't store the scores they need.

## Sounds

The app plays short sounds, synthesized in the browser (no audio files): your moves, with distinct sounds for captures, castling, promotion and check; a softer knock for the historical opponent's reply; a low tone when your move differs from the master's; session start and end; a low-time warning under 20 seconds and a flag-fall sound; the challenge countdown, start fanfare and results; invitations; a player accepting your challenge; incoming chat messages; new badges; and, for admins, password reset requests. The **Sound on/off** switch in the header turns them off (remembered per browser).

## Engine review

In solo training, Stockfish runs in the browser in a Web Worker. Before starting a session you pick the review depth (12-30, remembered for next time); each move is then reviewed in the background while you play: the engine searches the position's best move while you think, and the master's move and yours right after you move. The review at the end therefore appears almost immediately. Changing the depth on the review panel afterwards re-runs the review at the new depth.

Each move is scored by centipawn loss against the engine's best move at the same depth, converted to an accuracy percentage; the master's original move is scored the same way for comparison. Historical matching is separate and is decided by exact move equality: a different move can be historically incorrect but objectively stronger.

The analysis page of a finished game shows each move's accuracy and centipawn loss in the move list, and says who scored them. Its live engine panel always runs in your browser and is only for exploring; it may see a position slightly differently from the stored scores.

### Challenge scoring on the server

Challenges are scored by the server (`server/analysis.ts`), never by players' browsers, so that every player gains or loses exactly the same from the same move:

- **Each search is done once.** For each position of the challenge game the server searches the two best lines, and each other move played in it (the master's or a player's) with a search restricted to that move. Results are stored per engine and depth; everyone who reached that position or played that move is judged from the same stored result.
- **The engine's best move costs nothing.** It counts as 0 centipawns lost and 100% accuracy without a search of its own. Any other move loses what it falls short of the best line, never less than 0.
- **Searches are repeatable.** One thread, a fixed hash size, a cleared hash before each search, and a fixed depth, so a result doesn't depend on what was searched before.
- **Mates** count as ±100,000 centipawns, so missing a forced mate costs about everything.

Settings, as environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANALYSIS_DEPTH` | 24 | Search depth for new challenges (12-30). Each search at depth 24 takes roughly 10-20 seconds on one core. |
| `ANALYSIS_WORKERS` | CPU cores - 1 (at least 1) | Engines searching in parallel. Each runs in its own process at a lower priority than the web server. |
| `STOCKFISH_PATH` | set in the Docker image | A native Stockfish binary. Without it (as in local development) the server uses the slower WASM build from the `stockfish` npm package. |

The Docker image includes the official Stockfish 19 Linux build (GPLv3; its license is in `/usr/local/share/doc/stockfish`), which picks the fastest code the CPU supports. Admins see the engine, depth, workers, CPU cores, waiting searches and average search time in the **Admin** tab, and on Azure App Service also the plan's tier. Azure's Free and Shared tiers limit CPU time per day, which depth-24 analysis can exhaust.
