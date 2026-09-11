# GitHub attachments

Use native GitHub CLI attachments for new screenshots and videos in pull requests, issues,
and comments. Keep existing `screenshots` branches and hosted image references; historical
embeds depend on them.

## Before uploading

Attachments require GitHub CLI 2.99.0 or newer, authentication, and push access. Check the
CLI and the specific flag before uploading:

```bash
gh --version
gh pr comment --help
```

The help output must list `--attach`. If it does not, upgrade GitHub CLI and verify again.
For Homebrew:

```bash
brew update
brew upgrade gh
gh --version
gh pr comment --help
```

If `gh` is missing, install it with Homebrew or the matching package manager. Use GitHub's
[official installation instructions](https://github.com/cli/cli#installation) when no
package manager is available.

## Upload and embed

Write the report to a body file and pass one `--attach` flag per local file. Reference the
same local paths in the Markdown body so `gh` replaces them with hosted URLs and preserves
their alt text:

```bash
gh pr comment 123 --repo OWNER/REPO --body-file /tmp/qa-report.md \
  --attach /tmp/before.png --attach /tmp/after.png
```

The same flag works with `gh pr create`, `gh pr edit`, `gh issue create`, `gh issue edit`,
and `gh issue comment`. Unreferenced attachments are appended to the body. An upload can
partially succeed and still publish the body before returning nonzero; inspect the result
before retrying to avoid duplicate posts. Ask the user for images only when the running
interface cannot be reached.

See [GitHub's attachment documentation](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli)
for current CLI behavior.
