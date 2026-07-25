# Orders API Contract

## `POST /orders`

Checks payment status through BillLookup and processes matching pending orders.

### Request

```json
{
  "site": "doa.fti.or.th",
  "ref1": "051349900373583"
}
```

- `site` is required.
- `ref1` is optional.
- Without `ref1`, the existing batch behavior claims up to 100 pending orders within the configured date window.
- With `ref1`, the endpoint claims and checks exactly one pending order. This path does not apply the batch date window and can reprocess an order with `status: pending` and `process: processing`.
- A single-order check must not be run concurrently for the same `ref1` by multiple operators.

### Success Response Additions

The response includes `requestedRef1`.

- It is the normalized requested value for a single-order check.
- It is `null` for a batch check.

### Not Found

A single-order check returns HTTP 404 when there is no pending order for the specified `site` and `ref1`.
