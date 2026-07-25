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

## 2026-07-25 - Manual Check Processing Override

- Task summary: Let a single-order manual payment check reprocess an order currently marked `processing`.
- Added: Single-ref claims accept `process: processing` while retaining `status: pending`.
- Changed: `POST /orders` with `ref1` refreshes the processing claim before BillLookup and claims exactly one order per request.
- Fixed: Manual checks no longer return not found solely because a pending order was left in processing by an earlier run.
- Removed: None.
- Affected modules: Store order processing.
- Affected files: `store.js`.
- Database impact: Refreshes `processingStartedAt` through the existing claim update.
- API impact: No request or response shape change.
- Breaking changes: None.
- Migration required: No.
- Regression risk: Low; batch claims still exclude processing orders.
