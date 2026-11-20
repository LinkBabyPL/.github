# Engineering dashboard: setup and privacy

## Public display
This organization profile is public. It intentionally displays private repository names, commit messages, issue and pull-request titles, dates and status metadata. **Do not use this dashboard if those details must remain confidential.** Private repository code and issue bodies are not copied into the page.

## Enable daily refresh
1. In `LinkBabyPL/.github`, visit **Settings → Secrets and variables → Actions → New repository secret**.
2. Name it `LINKBABY_DASHBOARD_TOKEN`.
3. Provide a fine-grained PAT owned by an account that can read all LinkBabyPL repositories, including private repositories. Repository access: **All repositories** (subject to organization policy). Minimum permissions: **Metadata: Read**; **Contents: Read** (for commits); **Issues: Read**; **Pull requests: Read**; **Actions: Read** for CI status. Do not grant write permissions to this PAT.
4. If your organization requires PAT approval or SSO authorization, complete that in GitHub. Do not paste your token into README files or chats.
5. Go to **Actions → Refresh organization dashboard → Run workflow**. It also runs daily at 05:17 UTC.
6. Confirm the job finishes successfully and refreshes `profile/README.md` and `profile/assets/commit-heatmap.svg`.

The workflow uses a separate built-in `GITHUB_TOKEN` with `contents: write` for committing changes to the public profile repository. The read-only token is for private organization data and does not itself write.

## Accuracy
- The heatmap counts default-branch commits within 13 weeks, not all work in branches and not developer productivity.
- The open-issue and PR counts are current GitHub snapshots at refresh time.
- Workflow outcomes are the latest visible runs, not proof of deployment health.
- The generator fails closed when the token is missing or essential API pagination is incomplete. The previous snapshot remains visible until successful refresh.
- Repository-wide token scopes determine completeness. Review counts if organization access is restricted.
- The profile excludes the dashboard's own scheduled commits from the heatmap.
- If private project metadata must later be hidden, move this implementation to `.github-private` and delete the public profile history or rotate any exposed project identifiers as appropriate.

## Implementation
- [Generator](scripts/build-dashboard.mjs)
- [Scheduler](.github/workflows/refresh-dashboard.yml)
- [Profile](profile/README.md)
