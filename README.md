<p align="center"><img src="docs/logo.png" width="120" alt="Signoff AI logo"></p>

# Signoff AI

**Claude builds. You sign off.**

A desktop app over your own Claude Code. Claude does the work, alone or as a team in separate worktrees; you answer
its decisions, review its changes file by file, and approve anything that leaves your machine. No terminal juggling.

- Decisions as cards: context, options, a recommendation, evidence with the code next to it.
- Review by ticket, session, commit or today, with comments that go straight to the session.
- Teams: an implementer per piece and a reviewer, each on its own branch.
- Flow docs: Claude writes and keeps docs of how your code works, and every session reads them first.
- Search across code, files, decisions and chats.

## Install (macOS)

See [INSTALL.md](INSTALL.md). You need a Claude plan that includes Claude Code.

## Build from source

```bash
npm ci
npm test
npm run dist:mac:friends    # dist/signoff-ai-<version>.dmg
```

Development: `npm run dev`.

## Security

Read [SECURITY.md](SECURITY.md) and the full [security audit](docs/security-audit.md).

## License

[Functional Source License 1.1, Apache 2.0 Future License](LICENSE.md) (FSL-1.1-ALv2). You can read, use, change
and share the code for any purpose except offering a competing product or service. Each release becomes Apache 2.0
two years after it is published.

Written by [harshdigi](https://github.com/harshdigi).
