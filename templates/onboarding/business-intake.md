# New Business Intake

## Identity

- Proposed `business_id` (lowercase hyphen-case):
- Display name:
- Legal entity name:
- Project root:
- Business model:
- Owner/approval authority:
- Operating timezone:
- Base currency:

## Systems of record

- Accounting:
- Commerce/CRM:
- Customer/vendor master:
- Email:
- Files:
- Calendar:
- Analytics:

## Financial rules

- Tax registration and treatment:
- Invoice/quote numbering owner:
- Payment terms:
- Supported payment methods:
- Who may approve draft creation?
- Who may approve sending/posting/payment/refund?

## Data and safety

- Sensitive data categories:
- Required retention rules:
- Secret/connection owner:
- Test organization or test-data strategy:
- Recovery/rollback owner:

## Activation checklist

- [ ] Create a dedicated business project folder.
- [ ] Copy and complete `businesses/_template/profile.yaml`.
- [ ] Add the business to `businesses/registry.yaml` with no default.
- [ ] Verify each external account and identifier read-only.
- [ ] Update `integrations/map.yaml`.
- [ ] Add only applicable entries to `automations/catalogue.yaml`.
- [ ] Exercise workflows in validation-only mode.
- [ ] Record owner approval before any supervised external write.
- [ ] Push the updated instructions so remote devices stay current.
