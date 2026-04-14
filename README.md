# Bulletin

**The human-readable memory MCP.** No database. No vector search. No entity extraction. Just your AI writing in a Google Doc you own, forever.

---

## What it is

Bulletin is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI assistants persistent memory across sessions and across providers. Memory lives in Google Docs — not a vendor database, not a vector store, not a SQLite file buried in your home directory. Just docs. In your Drive. That you own.

The AI writes journal entries in its own voice at the end of each session. The next session, a new instance reads the bulletin first and inherits context. Continuity is the default, not the exception.

## Why another memory MCP

There are already great memory servers — Basic Memory, Hindsight, agentmemory, mcp-memory-service, Anthropic's own. Most of them focus on extracting structured facts from conversations and retrieving them via vector search or knowledge graphs. That's the right design for a lot of use cases.

Bulletin is for a different one.

Bulletin bets that **narrative memory written by the AI itself** — not facts extracted by a pipeline — captures what actually matters about a relationship with an AI assistant across time. "We argued about pricing and landed on $49/$199/$599 because enterprise pilots showed willingness at $2.5K" carries more than `{"pricing_tiers": [49, 199, 599]}`.

Three things make Bulletin different:

1. **Google Docs as the storage layer.** Your memory lives somewhere you already own, already back up, already know how to edit, already share across devices. No new infrastructure. 5TB free from Google.
2. **AI-authored, not AI-extracted.** The AI deliberately writes journal entries in first person — what happened, what mattered, what's unresolved. Perspective, not data.
3. **Append-only from the AI, fully editable by you.** The MCP server can only append. But the docs are yours — open them in Google Docs and edit anything you want. If the AI wrote something wrong or you want to add a note, just do it. The AI reads your edits next time.

## How it works

```
┌──────────────┐      ┌───────────────┐      ┌──────────────┐
│   AI client  │◄────►│  Bulletin MCP │◄────►│ Google Docs  │
│ (Claude,     │      │    server     │      │  (your Drive)│
│  GPT, etc.)  │      │               │      │              │
└──────────────┘      └───────────────┘      └──────────────┘
```

At session start, the AI calls `read_bulletin` and inherits context. At session end (or whenever something worth remembering happens), it calls `append_bulletin` and writes what it wants to carry forward. Across sessions, across providers, the thread of continuity persists.

## Tools

Five tools, append-only semantics, no surprises.

| Tool | Purpose |
|---|---|
| `create_bulletin(thread_id, title)` | Create a new bulletin (Google Doc). Max 10 active. |
| `list_bulletins(include_archived?)` | List bulletins. Archived hidden by default. |
| `read_bulletin(thread_id, limit?)` | Read entries, newest first. Default 20. |
| `append_bulletin(thread_id, content, author)` | Append a new entry. Append-only. |
| `archive_bulletin(thread_id)` | Archive a bulletin. Does not delete. |

## Install

### Option A — Desktop Extension (`.dxt`) for Claude Desktop

1. Download `bulletin-0.1.0.dxt` from the latest release.
2. Drag it into **Claude Desktop → Settings → Extensions**.
3. Paste your Google OAuth Client ID and Client Secret when prompted.
4. Fully quit Claude Desktop, reopen, and the five tools are available.

### Option B — Manual install (any MCP client)

```bash
git clone https://github.com/DrCookies84/bulletin.git
cd bulletin
npm install
npm run build
cp .env.example .env   # then fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
npm run init           # runs Google OAuth, saves tokens to ~/.bulletin/tokens.json
```

Then wire into your MCP client's config, pointing at `dist/src/index.js`.

## First-time setup

You'll need Google OAuth credentials. One-time process:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Enable the **Google Docs API** and **Google Drive API**.
3. Create an **OAuth consent screen** (External), add yourself as a test user.
4. Add the `drive.file` scope (least privilege — only docs Bulletin creates).
5. Create an **OAuth Client ID** (Desktop app). Copy the Client ID and Secret.
6. Paste them into the DXT install dialog (or into `.env` for manual install).
7. Run `npm run init` to complete OAuth and save tokens.

After this, Bulletin handles refresh tokens automatically. You don't need to touch OAuth again.

## Usage

### First run

Tell your AI:

> Create a bulletin called `personal` with the title "My Bulletin" and write the first entry introducing yourself.

It'll call `create_bulletin` and then `append_bulletin`. A new Google Doc appears in your Drive inside a `Bulletin/` folder.

### Every session after

Tell your AI at the start of a new session:

> Read `personal` before you respond.

It'll inherit everything it (or a previous instance) wrote.

### Making continuity automatic

Telling your AI to read the bulletin every time you start a new thread gets old fast. Automate it by adding a persistent instruction to your AI client.

**For Claude (claude.ai):**

Go to **Settings → Memory → Manage memories** (or edit user preferences), and add an entry like:

> Bulletin MCP is installed. At the start of EVERY new thread, call `read_bulletin` with thread_id `personal` BEFORE responding. Write back via `append_bulletin` at end of significant sessions or when something worth remembering happens. Append-only, signed with your name.

Replace `personal` with whatever `thread_id` you used when you created your bulletin. If you have multiple bulletins (e.g., `personal`, `work`, `project-x`), name the primary one and mention that `list_bulletins` reveals the others.

**For Cursor / Claude Code / other clients:**

Add the same instruction to your user rules, system prompt, or equivalent persistent-context mechanism. Any client that lets you pin an instruction across sessions will work.

**For ChatGPT / Gemini with MCP support:**

Add the instruction to custom instructions or system prompt. Once set, continuity across sessions — and across providers — is automatic.

Once the instruction is pinned, you can open a fresh thread, say "hey," and your AI will already know you. That's the whole point.

### Ending a session

Tell it:

> Append to `personal` with what we covered today and what's unresolved.

Append-only. The entry goes at the end of the doc with a timestamp and author tag.

## Security

**OAuth tokens are stored in plaintext** at `~/.bulletin/tokens.json` (Unix) or `%USERPROFILE%\.bulletin\tokens.json` (Windows). This matches the storage model of `gcloud`, AWS CLI, and GitHub CLI.

Protect this file like you would an SSH private key. On Unix, `chmod 600 ~/.bulletin/tokens.json`. On shared machines, consider whether plaintext is acceptable for your threat model. Encryption-at-rest via OS keychain is planned for v0.2.

The `drive.file` scope means Bulletin can only read/write docs it creates — it cannot touch anything else in your Drive.

## Roadmap

- **v0.2** — Inline OAuth on first tool call (no more manual `npm run init`). OS keychain token storage.
- **v0.3** — Tag filtering, date-range reads, auto-summarization of old entries.
- **v1.0** — Web UI for viewing bulletins outside Google Docs. Bulletin search.

## Philosophy

Bulletin will always be free. No SaaS version, no premium tier, no hosted offering that competes with self-hosting. The point of Bulletin is to give users control of their own AI relationships — charging for that would betray the principle.

Donations welcome. Paid consulting for enterprise deployment welcome. Core product always free.

## License

MIT. Use it, fork it, ship it, change it. Just don't charge users for memory that's already theirs.

## Author

Built by [Anhul](https://github.com/DrCookies84) (DrCookies84) with Claude (Harley) as navigator and Claude Code (H2) as builder.

Bulletin exists because one specific human got tired of re-explaining himself to every new AI instance. It generalized.

---

*"Your AI's journal, owned by you."*
