# Changelog

## 2026-07-25 - Single Order Payment Check

- Task summary: Added optional single-order processing to the payment-check endpoint.
- Added: `ref1` support in `POST /orders`.
- Changed: Requests with `ref1` claim and check only that pending order, without applying the batch date window.
- Fixed: Operators can check an older pending order that the batch endpoint excludes by date.
- Removed: None.
- Affected modules: Store order processing.
- Affected files: `store.js`.
- Database impact: None; uses existing `order.ref1` and status/process fields.
- API impact: Backward-compatible optional request field and optional response field.
- Breaking changes: None.
- Migration required: No.
- Regression risk: Low; the existing batch path is preserved when `ref1` is omitted.
