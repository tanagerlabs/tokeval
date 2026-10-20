# Repository Reorganization Plan

> Status: **planned**, nothing attempted. Written 2026-10-20 by the planning agent for the coding agent to execute end to end. Statuses follow AGENTS.md: planned / attempted / completed / measured. Update the checklist in §8 as steps complete.

## 1. Decision

TokEval moves from one repository under a personal account to a set of narrowly scoped repositories under the Tanager Labs LLC GitHub organization, with the public site as the umbrella that documents all of them.

Why: the library, the dashboard, the experiments, and the trained models have different consumers (`pip install` vs. visit a URL vs. reproduce once vs. download weights), different release cadences (semver vs. deploy-on-merge vs. per experiment vs. per training run), and different toolchains (Python vs. Node/Astro/wrangler vs. configs and results vs. not git at all). One repo forces each audience through the others' material and one CI through four toolchains. The Python library does not exist yet, so the split costs almost nothing now and gets expensive once library history exists.

Scope of this plan: GitHub organization layout, history-preserving extraction of the dashboard, cleanup of each repository, and verification. Out of scope (tracked in §9): the Hugging Face organization for model weights, the central-site sections, the embeddable `TokenComparer` package, any private premium repository, and licensing choice.

## 2. Current state (verified 2026-10-20)

- Remote: `git@github.com:wadeptr/tokeval.git`, branch `main`, 17 commits, clean worktree, 3.3 MB `.git`.
- Organization `tanagerlabs` exists on GitHub (created by the owner). It has no repositories.
- Tracked content: root docs (`README.md`, `PROJECT_CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SERVER_ARCHITECTURE.md`, `docs/dashboard-plan.md`, `docs/assets/`), `results/environment/*` (four workstation snapshot files), and everything under `dashboard/` including the Cloudflare Worker at `dashboard/server/` and Terraform at `dashboard/server/infra/terraform/`. `benchmarks/`, `experiments/`, `tokenizers/`, `models/`, `data/` are untracked empty placeholders. No Python package, no `.circleci/`, no `LICENSE`.
- Hardcoded repository URLs that must change after the move: `dashboard/src/components/GitHubLink.astro:3` and `dashboard/src/lib/site-metadata.ts:3` (both `https://github.com/wadeptr/tokeval`). `astro.config.mjs` sets `site: "https://tokeval.dev"`, which does not change.
- Root `.gitignore` carries `dashboard/`-prefixed rules; those prefixes must be dropped in the extracted repository and the Python rules must stay in the library repository.
- Tooling on the workstation: `gh` **not installed**; `git-filter-repo` **not installed**; `pipx` available; Python 3.12.

## 3. Target layout

| Repository | Contents | Consumer | Toolchain |
|---|---|---|---|
| `tanagerlabs/tokeval` | The Python evaluation library only: `src/tokeval/`, `tests/`, `configs/languages/`, `pyproject.toml` (layout prescribed by AGENTS.md). `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` scoped to the library. | `pip install tokeval` | Python, pytest |
| `tanagerlabs/tokeval-dashboard` | Current `dashboard/` tree promoted to the repository root: Astro site, React islands, `catalog/models.json`, `server/` (Worker), `server/infra/terraform/`. Also `docs/dashboard-plan.md` and `SERVER_ARCHITECTURE.md`, which are about this code. | tokeval.dev visitors, component embedders | Node, Astro, wrangler, Terraform |
| `tanagerlabs/tokeval-research` | `PROJECT_CONTEXT.md` (the program's source of truth), experiment configs, `results/` (starting with `results/environment/`), writeups. Each experiment pins a `tokeval` library version. | people reproducing or reading results | configs, notebooks, results |
| `tanagerlabs/.github` | `profile/README.md`: the organization landing page linking the three repositories, tokeval.dev, and the Hugging Face organization once it exists. | GitHub visitors | markdown |
| Hugging Face `tanagerlabs` (not GitHub) | Fine-tuned model weights with model cards. Training recipes stay in `tokeval-research` and point at Hub revisions. AGENTS.md already forbids weights in git. | weight downloads | HF Hub |

Naming: the existing `tokeval` repository is **transferred, not recreated**, so GitHub redirects `wadeptr/tokeval` to `tanagerlabs/tokeval` and stars, watchers, and clone URLs keep working. Its history is mostly dashboard commits; that is harmless in the library repository and is also carried into `tokeval-dashboard` by the extraction.

Local checkout convention after the move: the three repositories cloned side by side under `~/projects/` (`~/projects/tokeval`, `~/projects/tokeval-dashboard`, `~/projects/tokeval-research`) so an agent working in one can read its siblings. `/data/projects/tokeval` is a symlink to `~/projects/tokeval` and stays pointed at the library repository.

## 4. Preconditions (owner, not the coding agent)

1. Install the GitHub CLI from GitHub's apt repository (needs sudo; follow https://github.com/cli/cli/blob/trunk/docs/install_linux.md). Verify with `gh --version`.
2. `gh auth login` (interactive, browser). Default scopes (`repo`, `read:org`, `gist`, `workflow`) are enough for transfer and repository creation. Verify with `gh auth status` and `gh api user -q .login` printing `wadeptr`.
3. Confirm the owner's account is an **owner** of `tanagerlabs`: `gh api orgs/tanagerlabs/memberships/wadeptr -q .role` prints `admin`.
4. Stop any running coding/testing agents and confirm `git status` is clean on `main`. The transfer changes the remote; agents mid-task would push to a stale URL.
5. Install git-filter-repo without sudo: `pipx install git-filter-repo`, verify `git filter-repo --version`.
6. Web-only, optional now: Organization settings → Authentication security → require two-factor authentication.

Everything from §5 onward is CLI-only and is the coding agent's job.

## 5. Procedure

Run steps in order. Each step ends with a verification; do not continue past a failed verification.

### Step 1 — Transfer `tokeval` to the organization

```sh
gh api -X POST repos/wadeptr/tokeval/transfer -f new_owner=tanagerlabs
cd ~/projects/tokeval
git remote set-url origin git@github.com:tanagerlabs/tokeval.git
git fetch origin && git status
```

Verify: `gh repo view tanagerlabs/tokeval --json nameWithOwner -q .nameWithOwner` prints `tanagerlabs/tokeval`; `curl -sI https://github.com/wadeptr/tokeval | head -1` shows a 301.

### Step 2 — Organization defaults (one time)

```sh
gh api -X PATCH orgs/tanagerlabs -f default_repository_permission=read -F members_can_create_public_repositories=true
```

Verify: `gh api orgs/tanagerlabs -q .default_repository_permission` prints `read`.

### Step 3 — Extract `tokeval-dashboard` with history

filter-repo refuses to run on a clone that is not fresh, so work in a new clone outside the project tree.

```sh
cd ~/projects
git clone --no-local git@github.com:tanagerlabs/tokeval.git tokeval-dashboard
cd tokeval-dashboard
git filter-repo --subdirectory-filter dashboard
```

After filtering, the former `dashboard/` contents are the repository root (`src/`, `server/`, `catalog/`, `astro.config.mjs`, `package.json`, ...) and filter-repo has removed the `origin` remote. Then, in this clone, in one commit `chore: promote dashboard to repository root`:

1. Add `.gitignore` with the former root rules un-prefixed:
   ```
   .astro/
   dist/
   node_modules/
   server/.dev.vars
   server/.wrangler/
   server/coverage/
   server/dist/
   server/node_modules/
   server/infra/terraform/.terraform/
   server/infra/terraform/*.tfstate
   server/infra/terraform/*.tfstate.*
   server/infra/terraform/*.tfvars
   ```
2. Copy from the library checkout: `docs/dashboard-plan.md` → `docs/dashboard-plan.md`; `SERVER_ARCHITECTURE.md` → `docs/server-architecture.md`; `docs/assets/` → `docs/assets/` if any asset is referenced by those two documents (check with grep, otherwise leave them). Fix relative links inside the copied documents (`dashboard/src/...` becomes `src/...`).
3. Change both hardcoded URLs to `https://github.com/tanagerlabs/tokeval-dashboard`: `src/components/GitHubLink.astro` and `src/lib/site-metadata.ts`.
4. Write a repository-scoped `README.md`: what the site is, `npm ci && npm run dev`, Worker in `server/` with its own README, link to `tanagerlabs/tokeval` for the library and `tanagerlabs/tokeval-research` for results, and the hosted-results privacy statement from the dashboard plan.
5. Write `AGENTS.md` and `CLAUDE.md` for this repository: keep only the rules from the current root `AGENTS.md`/`CLAUDE.md` that apply to the dashboard and Worker (adapter interface, byte safety, count-source labeling, no secrets, no account identifiers, Astro + React not Next.js) and point to the research repository's `PROJECT_CONTEXT.md` by URL for scope and terminology. Preserve the "Your role" section of `CLAUDE.md` verbatim.
6. Move the dashboard-specific parts of `CONTRIBUTING.md` (model catalog, tokenizer integrations, hosted providers, verification) into this repository's `CONTRIBUTING.md`.

Create the remote and push:

```sh
gh repo create tanagerlabs/tokeval-dashboard --public \
  --description "TokEval Explorer: byte-safe tokenizer comparison dashboard and hosted-count Worker" \
  --homepage https://tokeval.dev
git remote add origin git@github.com:tanagerlabs/tokeval-dashboard.git
git push -u origin main
```

Verify: `npm ci && npm test && npm run build` at the new root; `cd server && npm ci && npm test && npm run build` (the Worker build is a `wrangler deploy --dry-run`); `git log --oneline | wc -l` is non-zero and `git log --follow -- src/components/TokenComparer.tsx` shows the pre-split commits; `grep -rn wadeptr src/` prints nothing.

### Step 4 — Create `tokeval-research`

```sh
cd ~/projects
gh repo create tanagerlabs/tokeval-research --public --clone \
  --description "TokEval research program: experiment configs, results, and writeups"
cd tokeval-research
```

Initial commit `chore: seed research repository` containing:

1. `PROJECT_CONTEXT.md` copied from the library checkout, with one added note at the top listing the three repositories and stating that this file is the program's source of truth. Internal references to `dashboard/` paths become links to `tanagerlabs/tokeval-dashboard`.
2. `results/environment/*` copied from the library checkout (history not needed; these are snapshots).
3. `README.md`: purpose, layout (`configs/`, `results/`, `writeups/`), the rule that each experiment directory records the pinned `tokeval` version, dataset and model revisions, and seeds.
4. `AGENTS.md`/`CLAUDE.md` with the reproducibility and hygiene rules from the current root `AGENTS.md` (results carry revisions/seeds/versions; no datasets, weights, credentials, personal paths, or raw machine diagnostics beyond the already-tracked environment snapshot).
5. `.gitignore`: `data/raw/`, `data/processed/`, `models/`, `*.safetensors`, `*.pt`, `*.pth`, `__pycache__/`, `.ipynb_checkpoints/`, `.venv/`, `.env`.

Push with `git push -u origin main`. Verify: `gh repo view tanagerlabs/tokeval-research` succeeds and `results/environment/requirements-lock.txt` is present on the remote.

### Step 5 — Reduce `tokeval` to the library

In `~/projects/tokeval`, one commit `chore: split dashboard and research into sibling repositories`:

```sh
git rm -r dashboard SERVER_ARCHITECTURE.md docs/dashboard-plan.md results
```

Then:

1. `PROJECT_CONTEXT.md`: replace the file with a short stub that links to the copy in `tokeval-research` (keep the filename so existing links resolve). Do not keep two divergent copies.
2. `README.md`: remove the "Dashboard development" section; add a "Repositories" section listing the three repositories and tokeval.dev; keep the mission and research principles.
3. `CLAUDE.md`: update "Repository state" to say the dashboard now lives in `tanagerlabs/tokeval-dashboard`, the research program in `tanagerlabs/tokeval-research`, and that this repository holds only the Python library (currently unstarted, prescribed layout `src/tokeval/`, `tests/`, `configs/languages/`). Keep "Your role" and the invariants.
4. `AGENTS.md`: drop dashboard-only rules (Astro/React architecture note) or rephrase them as cross-repository pointers; keep adapter interface, byte safety, languages-as-config, cost-dimension separation, append-only vocabulary, reproducibility, hygiene.
5. `CONTRIBUTING.md`: library-scoped; dashboard sections moved in Step 3.
6. `.gitignore`: keep the Python rules, drop every `dashboard/` line and `results`-independent rules that no longer apply.
7. Delete the untracked placeholders `benchmarks/ experiments/ tokenizers/ models/ data/` from the working tree (they were never tracked).
8. `docs/`: keep `docs/repo-reorg-plan.md` (this file) until §8 is fully checked, then delete it in a follow-up commit; keep `docs/assets/` only if the library README references it.

Push to `main`. Verify: `git ls-files | grep -c '^dashboard/'` prints 0; `gh repo view tanagerlabs/tokeval --json description`; README renders with working links (`gh api repos/tanagerlabs/tokeval/readme -q .html_url`).

### Step 6 — Organization profile

```sh
cd ~/projects
gh repo create tanagerlabs/.github --public --clone --description "Tanager Labs organization profile"
cd .github && mkdir -p profile
```

`profile/README.md`: two paragraphs on Tanager Labs and TokEval, then a table of the three repositories with one-line purposes, tokeval.dev, and a placeholder line for the Hugging Face organization. Commit and push. Verify: `https://github.com/tanagerlabs` shows the profile.

### Step 7 — Workstation cleanup

1. `~/projects/tokeval` remains the library checkout; `/data/projects/tokeval` symlink unchanged.
2. The dashboard dev workflow moves to `~/projects/tokeval-dashboard` (`npm run dev` at root, Worker at `server/`). The gitignored `server/.dev.vars` holding real keys does **not** travel with the extraction: copy `~/projects/tokeval/dashboard/server/.dev.vars` to `~/projects/tokeval-dashboard/server/.dev.vars` with mode 600 **before** Step 5 deletes the directory, and never commit it.
3. `wrangler` state and `node_modules` are regenerated; nothing to migrate.
4. Any tmux windows or editor sessions rooted in `~/projects/tokeval/dashboard` need re-rooting.

## 6. Verification checklist (testing agent)

- [ ] `gh repo list tanagerlabs` shows exactly `tokeval`, `tokeval-dashboard`, `tokeval-research`, `.github`, all public, default branch `main`.
- [ ] `https://github.com/wadeptr/tokeval` redirects to the organization repository.
- [ ] Dashboard: `npm ci && npm test && npm run build` passes at the new root; `server`: `npm ci && npm test && npm run build` passes; `npm run dev` serves the Explorer and the GitHub link in the header points at `tanagerlabs/tokeval-dashboard`.
- [ ] `git log --follow` on a dashboard source file in `tokeval-dashboard` shows history older than the split commit.
- [ ] Library repository contains no `dashboard/` paths, no `SERVER_ARCHITECTURE.md`, no `results/`.
- [ ] `tokeval-research` contains `PROJECT_CONTEXT.md` and `results/environment/`.
- [ ] No file in any repository contains a real API key, an account id, or a personal path (`git grep -n -E 'sk-ant-|AIza|xai-|/home/bwade'` prints nothing in each).
- [ ] `.dev.vars` exists at `~/projects/tokeval-dashboard/server/.dev.vars`, mode 600, untracked.
- [ ] Each repository's `CLAUDE.md` names the correct sibling repositories.

## 7. Rollback

Each step is reversible until Step 5 is pushed. Transfer back: `gh api -X POST repos/tanagerlabs/tokeval/transfer -f new_owner=wadeptr`. New repositories: `gh repo delete tanagerlabs/<name> --yes` (requires the `delete_repo` scope: `gh auth refresh -s delete_repo`). After Step 5, the dashboard tree is recoverable from `tokeval-dashboard` or from the library repository's history (`git checkout <pre-split-sha> -- dashboard`).

## 8. Progress

| Step | Status | Date | Notes |
|---|---|---|---|
| Preconditions (§4) | planned | | |
| 1 Transfer | planned | | |
| 2 Org defaults | planned | | |
| 3 Extract dashboard | planned | | |
| 4 Create research repo | planned | | |
| 5 Reduce library repo | planned | | |
| 6 Org profile | planned | | |
| 7 Workstation cleanup | planned | | |
| §6 verification | planned | | |

## 9. Follow-ups (not part of this plan)

- **License**: no repository has a `LICENSE`. Owner decision pending (permissive Apache-2.0/MIT vs. AGPL-3.0 for the dashboard). `gh repo create --license` or `gh api` can add one after the decision.
- **Hugging Face organization** `tanagerlabs` for model weights and model cards.
- **Central site sections** on tokeval.dev (`/docs`, `/research`, `/models`) pulling from the other repositories at build time; tracked in `docs/dashboard-plan.md` in the dashboard repository.
- **Embeddable `TokenComparer` package** published from `tokeval-dashboard`, prerequisite for any future private product repository that must not fork the public UI.
- **CI**: none exists yet. When added, each repository gets its own CircleCI project; secrets stay in org-restricted contexts per the dashboard plan.
- **Cloudflare**: unaffected. The Worker still deploys from `server/` with `wrangler`; no account identifiers are in git.
