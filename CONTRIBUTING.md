# Contributing to Synchro

Thank you for your interest in contributing to Synchro! This document outlines the contribution guidelines and branch protection policies to ensure code quality and maintain a stable main branch.

## Branch Protection Rules

To maintain code quality and prevent broken code from reaching production, the `main` branch is protected with the following rules:

### Required Protections

#### 1. Require a Pull Request Before Merging
- **Direct pushes to `main` are blocked** — all changes must go through a pull request
- This ensures every change is reviewed and validated before reaching production

#### 2. Require Status Checks to Pass Before Merging
All of the following CI jobs must pass before a PR can be merged:
- `typecheck-backend` — TypeScript type checking for backend
- `typecheck-client` — TypeScript type checking for frontend
- `lint-backend` — Linting checks for backend code
- `lint-client` — Linting checks for frontend code
- `test-backend` — Unit and integration tests for backend

**Why this matters:** Failed CI checks indicate broken code, merge conflicts, or TypeScript errors that would break production. Requiring passing checks prevents deployment failures.

#### 3. Require Branches to Be Up to Date Before Merging
- PRs must be rebased or merged with the latest `main` branch
- This prevents stale PRs from introducing merge conflicts

#### 4. Do Not Allow Bypassing Branch Protection
- These rules apply to everyone, including repository admins
- This ensures consistency and prevents accidental pushes to main

## Contribution Workflow

### Step 1: Create a Feature Branch
Branch naming convention: `feature/description` or `fix/description`

```bash
git checkout main
git pull origin main
git checkout -b feature/your-feature-name
```

### Step 2: Make Your Changes
- Write clean, well-documented code
- Follow the project's coding standards
- Ensure all code passes local checks:

```bash
# For backend changes
npm run typecheck:backend
npm run lint:backend
npm run test:backend

# For frontend changes
npm run typecheck:client
npm run lint:client
```

### Step 3: Commit Your Changes
Use descriptive commit messages:

```bash
git add .
git commit -m "feat: Add descriptive message about your changes"
```

Follow conventional commit format:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation
- `refactor:` for code refactoring
- `test:` for adding/updating tests
- `chore:` for maintenance tasks

### Step 4: Push to Your Fork
```bash
git push origin feature/your-feature-name
```

### Step 5: Create a Pull Request
- Go to the main repository (not your fork)
- Click "New Pull Request"
- Select your feature branch as the source
- Fill in the PR title and description
- Reference any related issues with `#issue-number`

### Step 6: Address Review Feedback
- Wait for CI checks to pass (required)
- Wait for code review (highly recommended)
- Make requested changes and push updates
- Ensure the branch is up to date with main before merging

## Enforcement

⚠️ **Important Notes:**

1. **You cannot push directly to main** — any attempt will be rejected by GitHub
2. **Your PR must pass all CI checks** — you cannot merge with failing tests or TypeScript errors
3. **Your branch must be up to date** — you cannot merge if your branch is behind main
4. **These rules apply to everyone** — including maintainers and admins

## Why These Protections Exist

Previously, broken code, TypeScript errors, and merge conflicts reached the main branch, causing Vercel deployment failures. These protections prevent that by:

- **Catching errors early:** CI checks catch TypeScript and linting errors before they reach production
- **Ensuring review:** PRs require review, preventing one-person mistakes
- **Maintaining branch hygiene:** Requires up-to-date branches prevent merge conflicts
- **Protecting main:** No one can bypass these rules, ensuring consistency

## Questions or Issues?

If you encounter any issues with the branch protection or have questions about the contribution process:
1. Check existing issues on GitHub
2. Open a new issue with details about your problem
3. Ask for help in discussions or pull request comments

## Code of Conduct

- Be respectful and professional in all interactions
- Provide constructive feedback in reviews
- Help newer contributors learn and improve
- Report any code of conduct violations to the maintainers

## Additional Resources

- [PR Submission Guide](./PR_SUBMISSION_GUIDE.md)
- [Backend README](./backend/README.md)
- [Client README](./client/README.md)
- [GitHub Docs on Branch Protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

---

Thank you for helping make Synchro better! 🚀
