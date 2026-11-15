# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and
(next) a morning digest of what ran overnight.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

Working on it with an agent: start at [AGENTS.md](AGENTS.md).

## Review copy

`pnpm preview` starts rig on localhost, downloads `/digest/2026-10-28` with curl,
and stops the server. The self-contained HTML is saved to ignored `.preview/index.html`;
never commit it, paste it into an issue, or attach it to chat.

After the owner approves publication, configure GitHub Pages to use GitHub Actions,
store the course marker as the `LANE_MARKER` repository secret, and manually run
**Publish review preview** with `with_marker` enabled. Only the sample digest HTML
is deployed, not the Node service or its JSON API. The workflow deletes its temporary
upload artifact after deployment; HTML and the marker never enter Git history.

Wait for the review and obtain separate approval before running the same workflow
with `with_marker` disabled. This replaces the page at the same URL with a
`no marker set` banner. Locally, `LANE_MARKER= pnpm preview` produces that clean copy,
even if `.env` contains a marker. Close the cleanup issue only after checking the
public page, and archive the plan with its issue list.
