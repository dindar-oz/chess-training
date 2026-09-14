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

## Engine review

After the game, the app runs Stockfish in a Web Worker. The depth slider controls the same search depth for the engine's best move, the original move, and the learner's move. Higher depth is slower but generally more stable.

The review reports:


Historical matching is still determined by legal UCI equality. Engine strength and historical matching are separate: a different move can be historically incorrect but objectively stronger.

Analysis depth is adjustable from `12` through `30`. Higher depth can take substantially longer; the backend allows up to two minutes per engine search.

## Engine review

Stockfish runs in the Node backend. The depth slider controls the same search depth for the engine's best move, the original move, and the learner's move. Analysis depth is adjustable from `12` through `30`.
