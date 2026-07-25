# ADR-20260725 Single Order Payment Check

- Status: Accepted
- Date: 2026-07-25

## Context

The batch `POST /orders` operation only claims up to 100 pending orders in a configured date window. Operations need a way to run BillLookup for one known pending order, including orders outside that window.

## Decision

Add an optional `ref1` request field to the existing `POST /orders` endpoint. When present, use `{ unit, ref1 }` as the claim filter. When absent, keep the existing unit and date-window batch filter.

## Consequences

- Existing callers retain batch behavior.
- Operators can check one pending order without changing shared date-window configuration.
- The request still uses the existing claim and payment-processing flow, so an in-progress order is not concurrently claimed.

## Affected Modules

- Store order processing

## Affected Files

- `store.js`
