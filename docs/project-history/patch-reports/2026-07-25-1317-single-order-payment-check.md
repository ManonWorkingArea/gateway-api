# Patch Report: Single Order Payment Check

## Objective

Allow operations to run the payment check for one known pending order.

## Scope

Extend the existing `POST /orders` endpoint with an optional `ref1` request field.

## Files Inspected

- `store.js`
- `package.json`

## Files Changed

- `store.js`
- `docs/project-history/changelog.md`
- `docs/project-history/current-state.md`
- `docs/project-history/current-state.json`
- `docs/erp-contract/orders-api.md`
- `docs/project-history/decisions/ADR-20260725-single-order-payment-check.md`
- This patch report

## Implementation Summary

`POST /orders` now normalizes an optional `ref1`. With a non-empty value, it claims and processes only the matching pending order under the requested site. The single-order filter deliberately omits the batch date window. Without `ref1`, the existing batch filter and response behavior remain in place. Successful responses include `requestedRef1` for traceability.

## Root Cause

The original endpoint always combined the site filter with a fixed batch date window and attempted up to 100 claims. There was no input to narrow processing to a known order, so older pending orders could not be checked directly.

## Business Impact

Operators can now investigate or process a specific pending payment reference without waiting for the bulk batch or changing its date-window behavior.

## Database Impact

None. The endpoint reads and updates the existing order, form, and enroll collections through the established flow.

## API Impact

Backward-compatible. `ref1` is optional in `POST /orders`; successful responses now contain optional `requestedRef1`.

## Contract Impact

The orders API contract and ADR document the single-order behavior and date-window bypass.

## Risks

An order that is already in `processing` remains protected from concurrent claims. The caller must wait for stale reset handling before retrying such an order.

## Regression Checks

- `node --check store.js` passed after the route change.
- Existing batch behavior is preserved structurally when `ref1` is omitted.
- Single-order and batch filters are mutually exclusive.

## Follow-up Recommendations

Deploy the gateway API and perform a controlled call against one known pending `ref1`.
