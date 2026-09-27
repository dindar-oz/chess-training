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

After logging in you land on a dashboard: one large illustrated button for each section (Game Library, Challenges, My Statistics, Awards, Leaderboard, and Admin Panel for admins). The section pages keep their tab row, with a **Home** tab to get back.

## Accounts and privacy

Create an account or log in from the app. Passwords are hashed server-side with Node `scrypt`, and the session uses an HTTP-only cookie. The game database is shared between users, but training statistics are stored per user in SQLite and are never returned to another account.

## Forgotten passwords

Accounts have no email address, so resets are approved by an admin. On the login screen, **Forgot my password** sends a request for a username (the reply is the same whether or not the account exists). Online admins get a notice, and the Admin tab lists pending requests; **Create reset link** (also available as **Reset password** for any user) produces a one-time link valid for 24 hours, which the admin passes to the user however they like. Opening it lets the user choose a new password, after which every existing sign-in for that account is logged out. Links are stored only as hashes and a newer link replaces an older unused one. Admins set by `ADMIN_USERNAMES` cannot be reset from the panel.

## Time controls

Before choosing a side, pick a time control: Untimed (default), a preset such as 10+0 or 15+10, or a custom base (1-180 minutes) plus increment (0-60 seconds). Only your clock runs; the historical opponent's moves are instant, the clock pauses while a deviation is corrected, and each of your moves adds the increment. If your flag falls, the session ends and the moves you played are analyzed. A timed-out session earns XP for matched moves only, without the completion or perfect-game bonus.

## Challenges

Open **Challenges**, choose a side (White, Black or Random), a time control and the engine review depth, tick online players to invite, and send. Invitees get a pop-up on any screen and can accept or decline; the creator starts once at least one player has accepted (invitations still open at that moment expire).

At the start the server picks a random game from the library (preferring games of 20+ plies). Everyone plays the same side with the same clock after a 3-second countdown. To keep it fair:

- The game's identity and moves are never sent to players while it is running; each player only receives the position they must move in. The game is revealed on the results screen.
- The server keeps every clock: it charges thinking time, adds the increment, pauses 1.1 s after a deviation while the line is restored, and flags players whose time runs out (also after a server restart; clocks keep running while the server is down).
- Players see each other's progress and clocks, never their moves.

Each player's browser analyzes **their own moves** with Stockfish in the background while they play, at the depth chosen for the challenge, and submits the results automatically as soon as they finish, time out or resign (a reload resumes it). The server ranks players (finishers above timeouts and resignations, then by accuracy), updates ELO, and records each player's challenge as a training session with XP as soon as every player's analysis is in, which is usually within a second of the last move. If a player who finished the game on time has left (or their page never sends the analysis), the other players' browsers analyze that player's moves for them once everyone is done: immediately if the player is offline, or after 60 seconds if they still look connected. A player who timed out or resigned and whose analysis hasn't arrived 10 minutes after everyone finished is ranked last. The waiting screen shows each player's status live. Players are trusted to report their own analysis. Lobbies are cancelled if the creator is offline for over a minute or nobody starts them within 30 minutes.

### Challenge chat

Players in a challenge (the host and everyone who accepted) share a simple message box from the waiting room through the results. Messages are relayed live and are never stored, on the server or in the browser, so reloading the page starts with an empty chat. Any player can mute the chat for themselves, and the host can mute it for everyone, which stops all players from sending until it is unmuted.

## ELO rating

Every player starts at 1200. Only challenges change the rating; solo training earns XP but never ELO. In a challenge, every pair of participants counts as one game: a player who finished beats anyone who timed out or left, otherwise the higher accuracy wins, and accuracies less than 1% apart are a draw. K is 32 divided by (players - 1), so a large challenge moves ratings about as much as a duel. Ratings never fall below 100. The math lives in `shared/elo.ts`; run its tests with `npm test`.

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

The **Awards** tab shows every badge, earned or still locked:

- **1st Game Completed**: finish your first game, in training or in a challenge.
- **First Challenge**: play a challenge through to the results (running out of time counts; resigning doesn't).
- **Hat Trick**, **On Fire**, **Master Mind**: match 3, 5 or 10 of the master's moves in a row within one challenge.

The server awards badges and remembers them per account. A new badge is celebrated once, with an animation and a fanfare: as a small corner card that doesn't block the board while your challenge clock is running, and as a full-screen moment otherwise. A badge earned while no page was open is celebrated at your next visit. Badges for play from before badges existed are granted automatically when the server starts.

## Sounds

The app plays short sounds, synthesized in the browser (no audio files): your moves, with distinct sounds for captures, castling, promotion and check; a softer knock for the historical opponent's reply; a low tone when your move differs from the master's; session start and end; a low-time warning under 20 seconds and a flag-fall sound; the challenge countdown, start fanfare and results; invitations; a player accepting your challenge; incoming chat messages; new badges; and, for admins, password reset requests. The **Sound on/off** switch in the header turns them off (remembered per browser).

## Engine review

Stockfish runs in the browser in a Web Worker. Before starting a session you pick the review depth (12-30, remembered for next time); each move is then reviewed in the background while you play: the engine searches the position's best move while you think, and the master's move and yours right after you move. The review at the end therefore appears almost immediately. Changing the depth on the review panel afterwards re-runs the review at the new depth.

Each move is scored by centipawn loss against the engine's best move at the same depth, converted to an accuracy percentage; the master's original move is scored the same way for comparison. Historical matching is separate and is decided by exact move equality: a different move can be historically incorrect but objectively stronger.
