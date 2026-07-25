# ADR-20260725 Single Order Payment Check

- Status: Accepted
- Date: 2026-07-25

## Context

The batch `POST /orders` operation only claims up to 100 pending orders in a configured date window. Operations need a way to run BillLookup for one known pending order, including orders outside that window.

## Decision

Add an optional `ref1` request field to the existing `POST /orders` endpoint. When present, use `{ unit, ref1 }` as the claim filter and permit an existing `processing` state when the order status remains `pending`. When absent, keep the existing unit and date-window batch filter.

## Consequences

- Existing callers retain batch behavior.
- Operators can check one pending order without changing shared date-window configuration.
- Batch processing does not claim in-progress orders; only the explicit manual ref1 path can supersede that claim.

## Affected Modules

- Store order processing

## Affected Files

- `store.js`
