# Business OS Context

## Purpose

Business OS gives the owner one conversational control surface for recurring work across multiple businesses while established applications remain the systems of record.

## Operating model

- The assistant interprets requests, gathers the correct business context, prepares actions, validates inputs, and summarizes results.
- External applications own durable operational records: accounting, commerce, email, files, calendars, and analytics.
- The owner remains the approval authority for consequential or customer-visible actions.
- Automation is introduced progressively: document first, dry-run second, supervised execution third, and unattended execution only after explicit approval plus monitoring and rollback controls.

## Design principles

1. **Separate businesses by default.** Every workflow begins with an explicit `business_id`.
2. **One owner per record type.** Avoid shadow databases and conflicting copies.
3. **Preview before consequence.** Draft and validate before posting, sending, charging, deleting, or changing state.
4. **Least data necessary.** Store routing metadata here, not operational datasets or credentials.
5. **Reusable core, thin adapters.** New businesses add profiles and mappings rather than forks of the OS.
6. **Auditable decisions.** Material changes have an owner, date, rationale, and verification evidence.

## Included

- System architecture, routing rules, source-of-truth map, approvals, integration status, automation catalogue, onboarding standards, and cross-business workflow definitions.

## Excluded

- Detailed product, customer, campaign, creative, codebase, bookkeeping, and fulfillment operations belonging to an individual business.
