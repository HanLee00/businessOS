# Operating Principles

1. Select a `business_id` before any integration action.
2. Pass the mapped organization/store/mailbox explicitly; never rely on defaults.
3. Keep operational records in their authoritative external system.
4. Preview calculations and payloads before external writes.
5. Require the documented approval level for customer-visible, financial, destructive, or security-sensitive actions.
6. Keep credentials and sensitive customer data out of this repository.
7. Separate business ledgers; combine only at the reporting layer.
8. Apply documented allocation rules to shared expenses.
9. Advance automation from documented to dry-run to supervised before considering unattended activation.
10. Record durable decisions in `memory/decisions.md` and reusable lessons in `memory/lessons.md`.
