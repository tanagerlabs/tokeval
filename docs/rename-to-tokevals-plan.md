# Rename Plan: TokEval → TokEvals

> Status: **planned**, nothing attempted. Written 2026-10-20 by the planning agent for the coding agent to execute. Statuses follow AGENTS.md: planned / attempted / completed / measured. Update §9 as steps complete, then retire this file in a follow-up commit once every box in §8 is checked.

## 1. Decision

The lab, the organization, the flagship library, and the site all take the name **TokEvals** (slug `tokevals`). The previous name `tokeval` was unavailable as a GitHub organization and collides with existing repositories and a third-party `.com`; `tokevals` was free in every namespace that matters, is a conventional plural for an evaluation suite (`evals`, `inspect_evals`), and gives the library the bare org name while the siblings take a prefix.

| Surface | Old | New | State on 2026-10-20 |
|---|---|---|---|
| GitHub organization | `tanagerlabs` (parent company, keeps existing) | `tokevals` | **created**, empty |
| Library repository | `tanagerlabs/tokeval` | `tokevals/tokevals` | planned |
| Explorer repository | `tanagerlabs/tokeval-dashboard` | `tokevals/tokevals-explorer` | transferred as `tokevals-dashboard` on 2026-10-20; second rename to `tokevals-explorer` in §12 (decided 2026-10-20: "Explorer" is the product name, "dashboard" was an implementation word) |
| Research repository | `tanagerlabs/tokeval-research` | `tokevals/tokevals-research` | planned |
| Org profile | `tanagerlabs/.github` (keeps, becomes parent listing) | `tokevals/.github` (new lab landing) | planned |
| Hugging Face organization | — | `tokevals` | **created**, empty |
| Site domain | tokeval.dev (owned, Route 53) | tokevals.dev, tokevals.com; Explorer served at `/explorer/` (§7) | **not yet registered**; blocked on AWS root sign-in support case, or register at Cloudflare Registrar instead |
| Python package | — | `tokevals` on PyPI | deferred: publish with the first real release, never a placeholder |
| npm scope | `@tokeval/*` (package.json names only, never published) | `@tokevals/explorer`, `@tokevals/hosted-tokenizer-worker` | org creation deferred by owner; package.json names change now |
| Cloudflare Worker | `tokeval-tokenizer-api` | `tokevals-tokenizer-api` | planned, see §5 caveat |
| Display name | "TokEval" | "TokEvals" | planned (assumption: same camel case; owner may override) |

Not renamed, on purpose (§6).

## 2. Why in this order

Repository transfer first, because GitHub redirects the old repository URLs after a transfer and every later link edit can target the final location. Brand copy second, in the same commits, because it is mechanical. Domain and Worker URL last, because they depend on the domain registration and on a Worker redeploy that re-enters secrets, and both can be done days later without blocking anything else.

## 3. Preconditions (owner)

1. `gh auth status` succeeds and `gh api user -q .login` prints `wadeptr`.
2. The owner's account is an owner of **both** organizations: `gh api orgs/tokevals/memberships/wadeptr -q .role` and the same for `tanagerlabs` both print `admin`.
3. All three local checkouts (`~/projects/tokeval`, `~/projects/tokeval-dashboard`, `~/projects/tokeval-research`) are clean on `main` and pushed (`git status` clean, `git log origin/main..main` empty). Stop running agents first.
4. Know whether the Worker has ever been deployed: `cd ~/projects/tokeval-dashboard/server && npx wrangler deployments list` (needs `wrangler login`). The answer decides §5 step 4.

## 4. Step 1 — Transfer and rename the repositories

The transfer API accepts a new name in the same call, so each repository moves and renames at once.

```sh
gh api -X POST repos/tanagerlabs/tokeval/transfer           -f new_owner=tokevals -f new_name=tokevals
gh api -X POST repos/tanagerlabs/tokeval-dashboard/transfer -f new_owner=tokevals -f new_name=tokevals-dashboard
gh api -X POST repos/tanagerlabs/tokeval-research/transfer  -f new_owner=tokevals -f new_name=tokevals-research
```

Then update each local checkout's remote and rename the directories:

```sh
cd ~/projects
git -C tokeval           remote set-url origin git@github.com:tokevals/tokevals.git
git -C tokeval-dashboard remote set-url origin git@github.com:tokevals/tokevals-dashboard.git
git -C tokeval-research  remote set-url origin git@github.com:tokevals/tokevals-research.git
mv tokeval tokevals && mv tokeval-dashboard tokevals-dashboard && mv tokeval-research tokevals-research
ln -sfn ~/projects/tokevals /data/projects/tokevals && rm /data/projects/tokeval
```

Workstation notes: `~/projects/venvs/tokeval` keeps its name (a venv path is not branding). Claude Code project memory is keyed by working directory; copy `~/.claude/projects/-data-projects-tokeval/` to `~/.claude/projects/-data-projects-tokevals/` so the planning agent keeps its notes. Re-root any tmux windows.

Verify: `gh repo list tokevals` shows the three repositories; `curl -sI https://github.com/tanagerlabs/tokeval | head -1` is a 301; `git -C ~/projects/tokevals fetch` succeeds.

## 5. Step 2 — Rename inside each repository

One commit per repository, `chore: rename to tokevals`. Exact inventory as of 2026-10-20; re-grep before editing (`git grep -n -i "tanagerlabs\|tokeval"`), because the coding agent may have touched files since.

### 5.1 Library (`tokevals/tokevals`)

- `README.md` lines 41–47, `CLAUDE.md` 12/23/25, `CONTRIBUTING.md` 8/10, `AGENTS.md` 47–48, `PROJECT_CONTEXT.md` 7/11: replace `tanagerlabs/tokeval` → `tokevals/tokevals`, `tanagerlabs/tokeval-dashboard` → `tokevals/tokevals-dashboard`, `tanagerlabs/tokeval-research` → `tokevals/tokevals-research`.
- Prose "TokEval" → "TokEvals"; the prescribed Python layout becomes `src/tokevals/`, package name `tokevals`, import `tokevals`. `CLAUDE.md` "Repository state" and the AGENTS.md layout section change accordingly.
- `tokeval.dev` links stay until §7.

### 5.2 Dashboard (`tokevals/tokevals-dashboard`)

Links and slugs:
- `src/lib/site-metadata.ts:3` `SOURCE_URL` → `https://github.com/tokevals/tokevals-dashboard`.
- `src/components/GitHubLink.astro:3` href → same.
- `AGENTS.md:7`, `CLAUDE.md:15/24/26`, `CONTRIBUTING.md:5`, `README.md:50–54`, `docs/dashboard-plan.md:240`: new org/repo slugs.
- `docs/dashboard-plan.md:111` and `docs/server-architecture.md:193` tree roots `tokeval-dashboard/` → `tokevals-dashboard/`.

Package identifiers (never published, safe to change):
- `package.json:2` `@tokeval/dashboard` → `@tokevals/dashboard`.
- `server/package.json:2` `@tokeval/hosted-tokenizer-worker` → `@tokevals/hosted-tokenizer-worker`.
- Run `npm install` in both directories so the lockfiles' root `name` fields follow; commit the lockfiles.

Brand copy ("TokEval" → "TokEvals"):
- `src/lib/site-metadata.ts:1` `SITE_NAME`, and the two FAQ answers mentioning TokEval.
- `src/layouts/BaseLayout.astro:43/51` JSON-LD `name`/`alternateName` → "TokEvals Explorer".
- `src/components/GitHubLink.astro:6–7` aria-label/title.
- `src/components/ExplorerGuide.astro:78`, `src/components/TokenComparer.tsx:155`, `src/pages/404.astro:14`.
- `README.md:1/3/38/43`, `CONTRIBUTING.md:1/3/113`, `AGENTS.md:8`, `CLAUDE.md:7/21`, `docs/dashboard-plan.md:3/159`, `docs/server-architecture.md:586/592`.
- `astro.config.mjs:54` error message text (cosmetic).

Worker name (`server/wrangler.jsonc:3` `tokeval-tokenizer-api` → `tokevals-tokenizer-api`). **Caveat:** a Worker's secrets, rate-limit bindings, and `workers.dev` URL belong to its name. Renaming creates a new Worker on the next deploy.
- If §3 item 4 shows **no deployments**: rename now; nothing else to do.
- If it **has been deployed**: rename in the same commit, but the deploy sequence is (a) `npm run deploy` creates the new Worker, (b) `npx wrangler secret put` for `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `CACHE_HMAC_SECRET`, and `XAI_API_KEY`/`ANTHROPIC_WORKSPACE_ID` if set, (c) update `PUBLIC_HOSTED_TOKENIZER_API_URL` wherever the site build reads it, (d) `curl` the new `/health`, (e) `npx wrangler delete --name tokeval-tokenizer-api`. The owner performs (b) because it needs the key values.

### 5.3 Research (`tokevals/tokevals-research`)

- `README.md:1/3/20/28–32`, `CLAUDE.md:7/21/23/31`, `AGENTS.md:7/21`, `configs/README.md:3`, `results/environment/requirements-lock.txt:1` comment: new slugs and "TokEvals".
- `PROJECT_CONTEXT.md`: lines 4–7 slugs; line 12 `**Project name:** TokEvals (\`tokevals\`)`; line 193 branding sentence; section titles "TokEval Explorer/Bench/Train/Serve" → "TokEvals Explorer/Bench/Train/Serve"; layout block lines 163–185 (`tokevals/`, `src/tokevals/`, `tokevals-dashboard/`); line 290. Leave the venv path lines 111/132–134 unchanged.

### 5.4 Organization profiles

- `tanagerlabs/.github` `profile/README.md`: repoint the three table links to `tokevals/...`, change "TokEval" → "TokEvals", and replace the last paragraph with a link to `https://huggingface.co/tokevals`. The paragraph framing TokEvals as a Tanager Labs project stays; that is the parent-company listing.
- Create `tokevals/.github` with `profile/README.md`: two paragraphs on what TokEvals is (reuse the mission text from PROJECT_CONTEXT.md), the same three-repository table, the site link (tokeval.dev until §7, then tokevals.dev), the Hugging Face link, and one line "A Tanager Labs project" linking to `https://github.com/tanagerlabs`.

```sh
gh repo create tokevals/.github --public --clone --description "TokEvals organization profile"
```

## 6. Identifiers that must NOT change

| Identifier | Where | Why it stays |
|---|---|---|
| `<tokeval-content>` / `--- TOKEVAL START ---` wrapper strings | `server/src/providers/content-estimate.ts:10–11` | They are part of the differential estimate and the baseline cache keys. Changing them changes measured baselines and invalidates persisted cache entries. Not user-visible. |
| `tokeval-theme` localStorage key | `ThemeToggle.astro:52/74`, `BaseLayout.astro:109` | Renaming it resets every visitor's saved theme for no benefit. |
| `tokeval.test`, `api.tokeval.test` | `server/test/worker.test.ts` | Fixture origins; renaming is churn with no value. |
| `\0tokeval:slim-sentencepiece-runtime`, `tokeval-slim-sentencepiece-runtime` | `astro.config.mjs:6/32` | Internal Vite plugin ids. |
| `~/projects/venvs/tokeval` | PROJECT_CONTEXT.md, CLAUDE.md | Local path, not branding. |
| Catalog and tokenizer source URLs | `catalog/models.json`, `src/lib/initial-tokenization.ts` | Third-party URLs. |

## 7. Step 3 — Domain and site URL (after tokevals.dev is registered)

Owner first registers `tokevals.dev` and `tokevals.com`. Cloudflare Registrar (account already exists, requires Cloudflare nameservers) or Route 53 once the AWS support case is resolved. Then, one commit in the dashboard, `chore: move site to tokevals.dev`:

1. `astro.config.mjs` `site` → `https://tokevals.dev` and add `base: "/explorer"`; `src/lib/site-metadata.ts` `SITE_URL` → `https://tokevals.dev/explorer/`. Canonical URLs, sitemap, and JSON-LD follow from these. Then fix every root-absolute reference so it resolves under the prefix (inventory as of 2026-10-20): `BaseLayout.astro` sitemap and favicon `href="/..."`; `404.astro` and `index.astro` `href="/"`; the fourteen `url("/logos/*.svg")` rules in `src/styles/global.css` (switch to relative `url("logos/...")` or a CSS variable built from `import.meta.env.BASE_URL`); `src/pages/robots.txt.ts` and `sitemap.xml.ts` output paths. The dev-only `"/api"` proxy in `astro.config.mjs` and `hosted-tokenizer.ts` is unaffected (`PUBLIC_HOSTED_TOKENIZER_API_URL` is absolute in production). Verify with `npm run build && npm run preview` opened at `/explorer/`: no 404s in the network panel.
2. Production `ALLOWED_ORIGINS` on the Worker gains `https://tokevals.dev` (and `https://www.tokevals.dev` if served). Set via `wrangler.jsonc` vars or deploy-time config, not committed secrets.
3. Hosting: upload the build to the `explorer/` prefix of the tokevals.dev static host. Redirects: `tokevals.dev/` → `/explorer/` (302 until the root lab site exists, see §11); `tokevals.com/*` 301 → `tokevals.dev/*`; `tokeval.dev/*` 301 → `tokevals.dev/explorer/*`, since the whole old site was the Explorer. Keep tokeval.dev registered indefinitely; it is the old brand and a typo target.
4. Replace remaining `tokeval.dev` links in the three READMEs, both org profiles, and `tanagerlabs/.github`.
5. If Search Console is set up for tokeval.dev, file a change of address after the redirect is live.

## 8. Verification checklist (testing agent)

- [ ] `gh repo list tokevals` shows `tokevals`, `tokevals-explorer`, `tokevals-research`, `.github`; `gh repo list tanagerlabs` shows only `.github`.
- [ ] Old URLs `github.com/tanagerlabs/tokeval{,-dashboard,-research}` redirect (301).
- [ ] In each repository `git grep -n "tanagerlabs/tokeval"` prints nothing, and `git grep -n -w "TokEval"` prints nothing outside §6 identifiers.
- [ ] Explorer: `npm ci && npm test && npm run build` passes; `server`: `npm ci && npm test && npm run build` passes; the header link opens `tokevals/tokevals-explorer`; page `<title>` and JSON-LD say "TokEvals".
- [ ] Both lockfiles carry the `@tokevals/...` names.
- [ ] Worker: `/health` responds at the new name; if the old Worker existed, it is deleted and all secrets are set on the new one (`npx wrangler secret list`).
- [ ] Org profiles render at `github.com/tokevals` and `github.com/tanagerlabs` with correct links.
- [ ] Local: `~/projects/tokevals`, `~/projects/tokevals-explorer`, and `~/projects/tokevals-research` exist, remotes point at `tokevals/`, `/data/projects/tokevals` symlink resolves, old names are gone.
- [ ] After §7: `curl -sI https://tokeval.dev/` is a 301 to `https://tokevals.dev/explorer/`; `https://tokevals.dev/` redirects to `/explorer/`; sitemap and canonical URLs use `https://tokevals.dev/explorer/...`; every asset and internal link resolves under the prefix.

## 9. Progress

| Step | Status | Date | Notes |
|---|---|---|---|
| §3 preconditions | attempted | 2026-10-20 | GitHub auth, both org roles, clean/pushed checkouts, and empty target org verified. Worker deployment history could not be queried without a non-interactive Cloudflare API token. |
| §4 transfer + local rename | completed | 2026-10-20 | Three repositories transferred/renamed; remotes and local directories updated; old paths removed; Claude project memory copied. |
| §5.1 library | completed | 2026-10-20 | Library branding, repository links, package/import naming, and prescribed `src/tokevals/` layout updated. |
| §5.2 dashboard | attempted | 2026-10-20 | Code, package scopes, lockfiles, UI/metadata branding, repository links, Terraform labels, and Worker name updated; 93 tests and both builds pass. Cloudflare deployment/secrets/health remain unverified without API authentication. |
| §5.3 research | completed | 2026-10-20 | Project name, slugs, package/layout references, and repository links updated; intentional venv path preserved. |
| §5.4 org profiles | completed | 2026-10-20 | Tanager Labs parent profile updated and public `tokevals/.github` profile created with GitHub, site, and Hugging Face links. |
| §7 domain and site URL | planned | | Blocked on registration of `tokevals.dev` and `tokevals.com`; existing `tokeval.dev` references intentionally remain. |
| §8 verification | attempted | 2026-10-20 | GitHub redirects/layout, local paths/remotes, code branding, package names, profiles, tests/builds, rendered metadata, and secret scans pass. Worker live health/secrets and post-domain redirects remain pending. |
| §12 Explorer repository rename | completed | 2026-10-20 | GitHub repository, local checkout, package name, plan filename, source links, and organization profiles renamed; old GitHub URL redirects; 66 Explorer tests and 27 Worker tests plus both builds pass. |

## 10. Rollback

Transfers reverse with the same API call (`new_owner=tanagerlabs`, old `new_name`). Everything else is one commit per repository and reverts with `git revert`. A renamed Worker is rolled back by redeploying under the old name and re-entering secrets.

## 11. Follow-ups (not part of this plan)

- **Root lab site.** A `tokevals/tokevals.dev` repository (named after the domain) owning the landing page and `/docs`, `/research`, `/models` sections, pulling from the other repositories at build time. Until it exists the root of tokevals.dev redirects to `/explorer/`.
- **Embeddable `TokenComparer` package** published from the Explorer repository once the npm org exists.
- **PyPI `tokevals`** with the first real library release.

## 12. Step 4 — Rename `tokevals-dashboard` → `tokevals-explorer` (completed 2026-10-20)

Decided after §4–§5 had already completed under the `tokevals-dashboard` name. This is a second, smaller rename: one repository slug, one package name, one local directory, and the references listed below. The Worker name `tokevals-tokenizer-api` and the §6 identifiers do not change. Precondition: the Explorer checkout is clean and pushed, and no agent is working in it.

### 12.1 Repository and local checkout

```sh
gh repo rename tokevals-explorer -R tokevals/tokevals-dashboard --yes
cd ~/projects
git -C tokevals-dashboard remote set-url origin git@github.com:tokevals/tokevals-explorer.git
mv tokevals-dashboard tokevals-explorer
git -C tokevals-explorer fetch origin && git -C tokevals-explorer status -sb
```

GitHub redirects `tokevals/tokevals-dashboard` to the new name, so nothing breaks while the references below are updated. Update the repository description to "TokEvals Explorer: byte-safe tokenizer comparison and hosted-count Worker" (`gh repo edit tokevals/tokevals-explorer --description ...`). Re-root tmux windows and editor sessions.

### 12.2 References (exact inventory as of 2026-10-20; re-grep before editing)

One commit per repository, `chore: rename dashboard to explorer`. In every file replace `tokevals/tokevals-dashboard` → `tokevals/tokevals-explorer` and the bare slug `tokevals-dashboard` → `tokevals-explorer`.

| Repository | Files |
|---|---|
| `tokevals/tokevals-explorer` | `README.md:52`; `src/components/GitHubLink.astro:3`; `src/lib/site-metadata.ts:3`; `docs/dashboard-plan.md:111` and `docs/server-architecture.md:193` tree roots; `package.json:2` `@tokevals/dashboard` → `@tokevals/explorer`, then `npm install` so `package-lock.json` follows (commit it). Rename `docs/dashboard-plan.md` → `docs/explorer-plan.md` with `git mv` and update its title line and any inbound links. Prose "dashboard" describing the product in `README.md`, `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, and the two docs may become "Explorer" where it reads naturally; leave the word where it means the generic UI concept. |
| `tokevals/tokevals` | `README.md:46`; `CLAUDE.md:23`; `CONTRIBUTING.md:8`; `AGENTS.md:48`; `PROJECT_CONTEXT.md:11`; this plan's §8 checklist line listing repository names. |
| `tokevals/tokevals-research` | `README.md:30`; `CLAUDE.md:23`; `PROJECT_CONTEXT.md:7`, `:174` (layout tree entry `tokevals-explorer/`), `:185`. |
| `tokevals/.github` | `profile/README.md:17` link target (label already says `tokevals-explorer`). |
| `tanagerlabs/.github` | `profile/README.md:15` link target. |

### 12.3 Verification

- [x] `gh repo view tokevals/tokevals-explorer` succeeds; `curl -sI https://github.com/tokevals/tokevals-dashboard | head -1` is a 301.
- [x] Across all five repositories `git grep -n "tokevals-dashboard\|@tokevals/dashboard"` prints nothing except historical notes in this plan.
- [x] Explorer: `npm ci && npm test && npm run build` passes; `server`: `npm ci && npm test && npm run build` passes; `package-lock.json` root name is `@tokevals/explorer`; the header link opens `tokevals/tokevals-explorer`.
- [x] Local: `~/projects/tokevals-explorer` exists with the new remote; `~/projects/tokevals-dashboard` is gone.
- [x] Both org profiles render with the new link.

Add a row for this step to §9 when attempted.
