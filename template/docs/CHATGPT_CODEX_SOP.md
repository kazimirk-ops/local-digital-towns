# ChatGPT Codex SOP

## Prompting Rules
- Always restate the task in one sentence before acting.
- Keep changes strictly scoped to the request.
- If requirements are missing or ambiguous, ask before changing code.

## File Scope Rules
- Only touch files explicitly requested or required to complete the task.
- Do not refactor runtime code unless asked.
- Preserve working routes and DOM IDs.
- When adding endpoints, add smoke tests.

## Output Rules
- For any new or modified file, output the full file contents.
- Use ASCII unless the file already uses Unicode.
- Keep comments minimal and only where they clarify non-obvious logic.

## Testing Rules
- Run smoke tests after 3 small tweaks, or after any auth/db change.
- For new endpoints, add or update smoke checks in `scripts/smoke.sh`.
- If tests cannot be run, state why and provide manual commands.

## Review Checklist Before Final Response
- Changes limited to requested scope.
- No runtime code changes unless explicitly requested.
- Smoke tests updated if endpoints changed.
- Files referenced by path with no ranges.

## Safety and Reverts
- Never revert user changes unless explicitly requested.
- If unexpected changes appear, stop and ask how to proceed.
