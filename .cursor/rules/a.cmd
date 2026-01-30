# DevOps, CI/CD & Git Workflow Rules

## Overview

We utilize a strict **Gitflow-inspired** workflow combined with **Conventional Commits**. No code reaches Production without passing through the automated CI pipeline and manual Code Review.

## 1. Git Branching Strategy

- **`main` (Protected):**
  - The "Golden Copy." Represents the live Production environment.
  - **NEVER** push directly to `main`.
  - Only merges from `develop` (via Release) or `hotfix/` branches are allowed.
- **`develop` (Protected):**
  - The "Integration" branch. Represents the Staging environment.
  - All feature branches merge into here.
- **`feature/[ticket-id]-[short-desc]`:**
  - Used for all new development.
  - _Example:_ `feature/AUTH-102-google-login`
  - Branches off `develop` and merges back to `develop`.
- **`fix/[ticket-id]-[short-desc]`:**
  - Used for non-critical bugs found in dev/staging.
- **`hotfix/[ticket-id]-[short-desc]`:**
  - **Emergency Only.** Branches off `main` to fix critical production bugs.
  - Merges into BOTH `main` and `develop` to keep them in sync.

## 2. Commit Standards (Conventional Commits)

- **Format:** `type(scope): subject`
  - _Type:_
    - `feat`: A new feature.
    - `fix`: A bug fix.
    - `docs`: Documentation only changes.
    - `style`: Formatting, missing semi-colons (no code change).
    - `refactor`: A code change that neither fixes a bug nor adds a feature.
    - `chore`: Build process, dependency updates.
  - _Subject:_ Imperative mood, lowercase, no period at end.
- **Example:** `feat(auth): implement jwt token refresh logic`
- **Enforcement:** Use `commitlint` in the husky pre-commit hook to reject invalid messages.

## 3. Pull Request (PR) Guidelines

- **Template:** All PRs must follow the project's PR template (Description, Ticket Link, Screenshots/Video, Checklist).
- **Size Limit:** Avoid "God PRs." A PR should ideally touch fewer than 15 files or 400 lines of code to make reviews manageable.
- **Review Requirements:**
  - Minimum **1 Approval** from a peer/senior.
  - **CI Checks Passed:** Lint, Test, and Build stages must remain green.
- **Merge Strategy:** Use "Squash and Merge" to maintain a clean linear history in `develop` and `main`.

## 4. CI/CD Pipelines (Automation)

The pipeline runs on every push to a PR and every merge to protected branches.

### Stage 1: Validation (Runs on PRs)

1.  **Linting:** `npm run lint` (ESLint + Prettier). Fails on warnings or errors.
2.  **Type Check:** `tsc --noEmit` (TypeScript strict mode).
3.  **Unit Tests:** `npm run test:unit`.

### Stage 2: Build (Runs on Merge)

1.  **Build Check:** `npm run build`. Ensures the Next.js/Express build succeeds without errors.
2.  **Containerize:** Build Docker image (if applicable) and scan for vulnerabilities.

### Stage 3: Deployment (Continuous Delivery)

- **Staging:** Automatic deployment to the Staging Environment when code is merged to `develop`.
- **Production:** Manual approval button (or Tag-triggered) deployment when code is merged to `main`.

## 5. Environment Management

- **Strict Separation:**
  - **Local:** `.env.local` (Not committed).
  - **Staging:** Connected to a "Staging DB". Mock payments/emails.
  - **Production:** Connected to "Production DB". Real payments/emails.
- **Config Integrity:**
  - Use a `config.ts` validator. If a required environment variable (e.g., `STRIPE_KEY`) is missing, the application must **crash immediately** on startup rather than run in an unstable state.

## 6. Versioning & Tagging

- **Semantic Versioning:** Use `vX.Y.Z` (Major.Minor.Patch).
- **Release Tags:** Every deployment to production must be accompanied by a Git Tag (e.g., `v1.2.0`).
