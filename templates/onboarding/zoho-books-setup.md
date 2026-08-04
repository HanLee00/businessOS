# Zoho Books Setup Intake

Complete one copy per business. Do not paste credentials or tokens.

- Business ID:
- Zoho region/domain:
- Connection method/name:
- Organization ID:
- Organization display name:
- Legal entity name:
- Base currency:
- Timezone:
- Tax registration/treatment:
- Invoice numbering managed by Zoho?:
- Default payment terms:
- Existing test customer ID (optional):
- Existing test item ID (optional):
- Test environment: sandbox/test organization/live organization:
- User-approved maximum test action: read-only / preview / create unsent draft:

## Read-only verification

- [ ] Organization ID and display name match.
- [ ] Base currency and timezone match the business profile.
- [ ] Required invoice fields are discoverable.
- [ ] Contact and item lookup works without creating records.
- [ ] No write was performed.

## Separate approval required

- [ ] Owner explicitly approved creation of one unsent synthetic draft.
- [ ] `send`, `post/finalize`, and `record_payment` remain false.
- [ ] The returned draft ID and status were reviewed in Zoho.
