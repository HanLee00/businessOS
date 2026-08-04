# Automation Approval Policy

`architecture/approval-boundaries.md` is canonical.

Automation lifecycle does not replace action approval:

- `documented` and `dry_run` perform no external writes.
- `supervised` actions run only within their approved business, scope, and action type.
- `active` unattended execution requires a separate recorded decision, least-privilege connection, idempotency, monitoring, failure handling, and a pause mechanism.
- Customer sends, posting/finalizing, payment recording, refunds/credits, voids/deletions, and permission changes retain their assigned approval boundary unless an explicit policy amendment names the exact automation and limits.

No automation is currently `active`.
