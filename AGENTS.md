# AGENTS.md

## What it is

A static slideshow of the 50 projects in `~/Projects`: one screenshot per project with its GitHub
repo and live demo link. `build.mjs` scans sibling repos (plus a small `EXTRA_REPOS` list for
finished builds kept elsewhere), picks a screenshot from each, resizes it, checks the demo URL, and
writes a single self-contained `index.html`. It is not a portfolio CMS and has no backend, database,
or runtime dependency — the output is plain files.

## Commands

```bash
node build.mjs                 # regenerate data.json + index.html from ~/Projects/* repos
open index.html                # view locally (file:// works, no server needed)
npx serve .                    # optional: serve over http to test from a phone
```

Rebuild after any project changes. The script needs the sibling repos present at `../<repo>` (and
`EXTRA_REPOS` paths); on a fresh clone of this repo alone it will find nothing and must be run from
its usual location inside `~/Projects`.

## Architecture

- `build.mjs` — the whole pipeline: repo discovery → image ranking → resize → demo check → metadata
  → template injection. Five small tables near the top control behaviour: `SKIP` (repos to omit),
  `EXTRA_REPOS` (finished builds outside `~/Projects`), `IMG_OVERRIDE` (force a specific screenshot),
  `OVERRIDES` (display names), `TAGS` (category regexes).
- `template.html` — the UI: markup, CSS, and all client JS. Contains the literal placeholder
  `/*__DATA__*/[]`, which `build.mjs` replaces with the project array.
- `index.html` — generated. Never edit by hand; it is overwritten on every build.
- `data.json` — generated project metadata, kept for inspection and diffing.
- `img/<repo>.jpg` — generated 1500px-wide JPEGs, one per project.
- `.meta-cache.json` — GitHub API responses (description, homepage, language, pushed date). Committed
  so rebuilds work offline and never re-hit the unauthenticated 60/hour quota.

## Decisions and constraints

- **Image selection is ranked, not curated.** `screenshot.*` beats `hero` beats `preview` beats
  `screenshot-*`; landscape images are preferred, sub-420px images are ignored, and `og-card`/
  `social-card`/icons rank last. Search is capped at depth 2 and skips `skills/`, otherwise a repo
  that vendors other projects' assets would show someone else's screenshot.
- **Demo URL resolution order:** `github.io/<repo>/` first, then the repo's declared homepage. A URL
  counts as live only if it returns a non-404. The `demoLive:false` path exists for repos with no
  web build; the UI then labels the card instead of linking it.
- **Descriptions come from the local README first**, then the API, then a generic fallback — the
  album must stay readable if the API is rate-limited. Dates fall back to `git log`, language to the
  most common tracked file extension.
- **`learncpp` is in `SKIP`** because `github.com/somphol/learncpp` returns 404 (not public). Do not
  re-add it without making the repo public; the card would carry a dead link.
- **`project-album` is in `SKIP`** so the album does not show itself.
- **`EXTRA_REPOS` holds `~/bangkok-miniature`**, a finished, live build that lives outside
  `~/Projects`. Keep that list short and explicit; anything else belongs in `~/Projects`.
- **Skill-catalog repos are included** (`opencode-skills`, `calculus-explorer-3d-skill`,
  `serenity-3d-studio-skill`). They are separate public builds with their own live pages, so they are
  cards of their own even when their preview resembles the app they scaffold.
- **`city-miniature` is in `IMG_OVERRIDE`** because its WebGL canvas draws after a headless
  screenshot fires, producing an empty frame.
- Images are committed. Regenerating them changes binary diffs; that is expected and fine.

## Known issues

- The headless-capture fallback needs Google Chrome at the hardcoded macOS path; on another machine
  a repo without a local screenshot would end up with no image (the UI shows "No screenshot yet").
- Demo checks are a point-in-time HEAD 200. GitHub Pages can be mid-deploy and look dead.
- `serenity-3d-studio-skill` ships only the app's own preview, so its card image looks like the
  `serenity-3d-studio` card. Point `IMG_OVERRIDE` at a catalog screenshot if that becomes confusing.
- No automated test suite; `build.mjs` prints its own summary (project count, missing images, dead
  demos, missing-from-HTML) and that is the verification step.

## Continuity

- Published: <https://somphol.github.io/project-album/> — served from `main` (repo root) on GitHub
  Pages. Push to `main` to update; Pages rebuilds in about a minute.
- Local source of truth: `~/Projects/project-album`.
