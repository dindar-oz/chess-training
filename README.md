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

## Accounts and privacy

Create an account or log in from the app. Passwords are hashed server-side with Node `scrypt`, and the session uses an HTTP-only cookie. The game database is shared between users, but training statistics are stored per user in SQLite and are never returned to another account.

## Time controls

Before choosing a side, pick a time control: Untimed (default), a preset such as 10+0 or 15+10, or a custom base (1-180 minutes) plus increment (0-60 seconds). Only your clock runs; the historical opponent's moves are instant, the clock pauses while a deviation is corrected, and each of your moves adds the increment. If your flag falls, the session ends and the moves you played are analyzed. A timed-out session earns XP for matched moves only, without the completion or perfect-game bonus.

## Administrators

Only admins can import games into the shared library or delete them. Admins also manage users in the **Admin** tab: promote to admin or demote, disable (logs the user out and blocks login), re-enable, or delete (permanently removes the account with its training history and XP).

The first admin comes from the `ADMIN_USERNAMES` environment variable (comma-separated, case-insensitive). Listed users are promoted when the server starts, so:

1. Register the account in the app first.
2. Restart the server with the variable set. No administrator rights are needed; it only applies to that terminal session:

   ```powershell
   $env:ADMIN_USERNAMES="yourname"; npm run server
   ```

   With Docker: `docker run -e ADMIN_USERNAMES=yourname ...`

Registering first matters: promotion by name would otherwise hand admin rights to whoever registers that name. Admins listed in `ADMIN_USERNAMES` show as locked in the panel and can't be demoted, disabled or deleted there. Admins also can't change their own account, so at least one admin always remains.

## Engine review

After the game, the app runs Stockfish in a Web Worker. The depth slider controls the same search depth for the engine's best move, the original move, and the learner's move. Higher depth is slower but generally more stable.

The review reports:


Historical matching is still determined by legal UCI equality. Engine strength and historical matching are separate: a different move can be historically incorrect but objectively stronger.

Analysis depth is adjustable from `12` through `30`. Higher depth can take substantially longer; the backend allows up to two minutes per engine search.

## Engine review

Stockfish runs in the Node backend. The depth slider controls the same search depth for the engine's best move, the original move, and the learner's move. Analysis depth is adjustable from `12` through `30`.
