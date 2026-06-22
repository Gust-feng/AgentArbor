# Skills Acceptance Note

## Changed Packages

- `.agents/skills/<skill-name>/SKILL.md`

## Checks

- Directory name matches frontmatter `name`.
- Frontmatter has `name` and `description`.
- Body is concise and executable.
- References, scripts, and assets are loaded or used only on demand.
- The package does not promise RAG, deep auto-triggering, script auto-execution, or RuntimeDatabase body persistence.

## Commit Recommendation

`.agents/` is ignored by default. If the samples should be shared, either force-add the selected sample files or change the ignore policy in a separate, explicit commit.
