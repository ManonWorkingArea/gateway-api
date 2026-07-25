# Current State

- Latest completed task: Added optional single-order payment checking with `POST /orders` and `ref1`.
- Current project focus: Reliable payment-status processing for pending course orders.
- Active modules: `store.js` order processing and offline confirmation.
- Completed work: The batch payment check remains available; operators may now check one pending order by `ref1`, including older orders outside the configured batch date window.
- Pending work: Deploy the gateway API change and monitor the first production single-order request.
- Known risks: Orders already in `processing` cannot be reclaimed until stale-processing reset criteria are met.
- Unresolved issues: The batch endpoint still has a fixed date window by design.
- Next recommended actions: Deploy, then invoke the endpoint for one known pending `ref1` and inspect the response summary.
