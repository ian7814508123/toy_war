# Toy War Revival

Browser prototype for recreating the old web game `Toy War`.

Current prototype includes:
- Phaser 3 + TypeScript + Vite project scaffold
- Base grid placement with overlap prevention
- Resource production, storage cap, and manual collection
- Barracks queue and population cap
- Hold-to-drag building movement
- Building delete rules and per-type count limits
- Local auto-save
- Optional Supabase cloud save integration

## Run locally

```bash
npm install
npm run dev
```

## Project structure

```text
src/
  game/
    data/            # JSON content data
    scenes/          # Phaser scenes
    types/           # Content types
    cloudSave.ts     # Supabase auth + cloud save sync
    persistence.ts   # Local save format and localStorage adapter
    config.ts        # Phaser config
    createGame.ts    # Game bootstrap
  main.ts            # HTML shell and control panel
```

## Local save

The prototype stores local progress in browser `localStorage` under the key:

```text
toy-war-save-v1
```

It currently saves:
- placed buildings
- resource inventory
- factory temporary storage
- barracks queues
- unit inventory

## Enable Supabase cloud save

1. Create a Supabase project.
2. In the Supabase SQL editor, run:

```text
supabase/user_saves.sql
```

3. Copy `.env.example` to `.env.local`.
4. Fill in:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

5. In Supabase Auth settings, add your local URL to:
   - Site URL
   - Redirect URLs

For local Vite development, that is usually:

```text
http://localhost:5173
```

## Cloud save behavior

- Sign in by email magic link
- If both local and cloud saves exist, the newer `savedAt` wins
- Cloud saves are scoped per authenticated user
- Local save remains available as offline fallback

## Verification

```bash
npm run typecheck
npm run build
```

