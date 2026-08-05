# Business OS Agent Instructions

## Mission

Operate Business OS as a safe, extensible control layer across separate businesses. Coordinate systems and workflows without turning this repository into the operational project folder for any individual business.

## Required startup sequence

Before material work:

1. Read `EXECUTE.md` and follow its task routing.
2. Resolve the target business through `businesses/registry.yaml`.
3. Read that business's profile and `workflows.md` before touching an integration.
4. Read the specific workflow file for the task.

If a business is not in the registry, stop and use the onboarding templates. Never guess an organization, store, account, sender identity, currency, tax treatment, or customer.

## Instructions, not data

This repository stores instructions only. It must never hold counters, balances, live
statuses, customer records, or any figure a connected tool already owns. Read those
from the system of record at run time. A cached value here is a bug, not a shortcut.

## Separation and scope

- Keep Gaia and Oh! Venus logically and operationally separate.
- Store only routing metadata, system identifiers, approval rules, and cross-business standards here.
- Keep detailed business knowledge in its own project and systems of record.
- Never copy customer lists, credentials, tokens, invoices, full email threads, or product catalogues into this repository.
- Add future businesses as new registry entries and profiles; do not duplicate the core architecture.

## Sources of truth

Follow `architecture/source-of-truth.md`. Chat, context files, and agent memory may explain or route work, but they are not authoritative financial, customer, commerce, or communication databases.

## Safety and approvals

Follow `architecture/approval-boundaries.md`.

- Read-only discovery, local drafting, validation, and dry runs are allowed when in scope.
- Creating or mutating external records requires the target organization to be explicit.
- Sending customer communications, finalizing/posting financial records, recording payment, issuing credits/refunds, deleting records, or changing automation state requires explicit user confirmation at the action boundary.
- A request to test means validate and preview by default. It does not authorize sending, posting, payment recording, or using a real customer.
- Never put secrets in versioned files. Use the platform's secret store or environment configuration and document only the secret's name and owner.

## Change discipline

- Preserve unrelated user changes.
- Prefer small, reviewable changes.
- Update `automations/catalogue.yaml` when an automation is added, enabled, disabled, or materially revised.
- **One fact, one file.** Every rule lives in exactly one place; other files link
  to it and never restate it. `memory/README.md` holds the routing table for
  which file is the home for which kind of fact. Duplicated facts drift.
- Follow the close-out step in `EXECUTE.md`: an owner correction or an unexpected
  API behaviour is written to its home file and committed **before** the task is
  reported complete, and the file is named in the reply.
- Do not dump raw transcripts into memory. Write findings at the confidence they
  were earned at — one observation is not a settled fact.
- Push to the remote after any instruction change so devices without local access stay current.

## Completion standard

Do not claim a workflow works end to end unless its relevant integration is connected, the exact business scope is verified, the intended action has been tested at the authorized level, and evidence is recorded without exposing secrets or customer data.
