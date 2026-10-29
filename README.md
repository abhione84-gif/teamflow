# Teamflow

A fresh, standalone task and follow-up dashboard. Source files are in `dist/` so the app can run on any static web host without a build step.

## Run locally

```sh
npm run dev
```

Open http://localhost:4318. Run `npm run check` to check JavaScript syntax.

## Features

- Create, edit, complete, and delete tasks.
- Board, list, and calendar views.
- Projects, owners, priorities, due dates, and follow-up dates.
- Search and filter tasks; find overdue work and today's priorities.
- JSON export and import for backups.
- Responsive layout and keyboard navigation.

## Data

Tasks are stored in this browser's local storage under `teamflow-v1`. Each browser and origin has its own data. This version does not synchronize data between people or devices, and it does not implement team accounts. The initial tasks are clearly labeled sample data; use Settings to start with an empty workspace.

This is a new app. It does not contain or migrate data from the earlier Teamflow site.

## Deploy to Vercel

Upload the complete project, including the `dist` folder. The entry point is `dist/index.html`.

The included `vercel.json` sets the static output directory to `dist` and skips the build step. In Vercel use Framework Preset `Other`, keep Root Directory at the repository root, and redeploy after the full source is on GitHub.

Do not run `server.mjs` on Vercel; it is only for local preview. Vercel serves the files in `dist` directly.
