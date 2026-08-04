# Business OS

The shared control layer across separate businesses. It defines how work is routed,
which external system owns each record, and where human approval is required.

**Start with [`EXECUTE.md`](EXECUTE.md).** That is the entry point for taking action.

## What this repository is

An instruction library for AI agents (Claude, ChatGPT) operating business tools
through Composio — Zoho Books, Shopify, Google Sheets, and others as they are added.

It is **instructions only**. It holds no counters, balances, customer records, or
operational data of any kind. Every durable record lives in the tool that owns it.
See `architecture/source-of-truth.md`.

It is also **business-neutral**. Gaia and Oh! Venus keep detailed knowledge and daily
work in their own project folders; only cross-business routing metadata lives here.

## How it is used

- **Owner device** — local folder, full read/write, where these instructions are authored.
- **Any other device** — reads this repository over the web for the same instructions,
  then executes against the live tools. It writes nothing back here.

When the local vault changes, push so both stay identical.

## Structure

```text
businessOS/
├── EXECUTE.md          # Entry point and task routing
├── AGENTS.md           # Operating and safety rules
├── CLAUDE.md           # Claude entry point
├── architecture/       # Design, source-of-truth map, approval boundaries
├── automations/        # Automation inventory and lifecycle
├── businesses/         # Thin per-business profiles and workflows
├── context/            # Purpose and operating principles
├── integrations/       # Routing map and provider runbooks
├── memory/             # Decisions, lessons, known issues
├── reporting/          # P&L and dashboard specifications
├── templates/          # Request schemas and onboarding
└── workflows/          # Shared workflow specifications
```

## What never belongs here

Credentials, tokens, bank details, customer lists, invoice or payment data, full
email threads, product catalogues, or any cached figure that a connected tool
already owns.
