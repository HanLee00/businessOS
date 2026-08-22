# Known Issues

Durable, still-unresolved constraints only. Anything that is merely "current status"
belongs in the live system, not here.

## Composio has no plain CREATE_INVOICE wrapper for Zoho Books

The wrapper toolset exposes list/get/update/delete/recurring/create-from-salesorder,
but no one-off invoice create, and no create-estimate or create-sales-order either.
Not an access gap - the same connection reaches the full REST API via
`proxy_execute`. Full working path, plus the auto-number and line-item-replace
gotchas, is documented in `workflows/invoicing/README.md`.

## Zoho item variants have no verified native path

Item creation through Composio returned `has_variant: false`; a requested variation
was preserved as SKU and description rather than a native Zoho variant. Use a native
item-group/variant workflow only after its API behaviour is separately verified.

## Oh! Venus write access is unverified

Reads work. No write has been performed against organization `933897042`, and
Premium Trial write success would not prove Free-plan write behaviour. Verify with
one supervised, harmless write before trusting any Oh! Venus automation.

## Quotations and reporting are documented but never executed

`workflows/quotations.md` and the `reporting/` specifications have not been run
end to end against live systems. Expect undiscovered API behaviour comparable to
the invoice auto-number and line-item issues. Run each once under supervision
before relying on it from a device without local file access.

## GWW mobile Sheet mirror covers one of four suppliers

`businesses/gaia/product-data.md`'s Sheet mirror (the only remote-reachable Gaia
product/cost source) covers Oren Sport only; the local master also has Rightway,
Esping/Le'fonse, and Megah Textile. A phone-only session cannot correctly quote or
invoice those three suppliers today — it must stop and ask rather than estimate.
Extension is planned (see that file) but not done; requires Sheets range-write
access and the local CSV rows for those suppliers.

## Gaia account mapping is not reviewed

`reporting/account-mapping.yaml` is `draft_requires_account_review` with
`policy_status: not_defined`. Any P&L built on it would produce confident but
unvalidated numbers. Review the mapping before generating financial reports.
