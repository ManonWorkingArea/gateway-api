# Current State

- Latest completed task: Order checks now return PostReceipt response diagnostics.
- Current project focus: Reliable payment-status processing for pending course orders.
- Active modules: `store.js` order processing and offline confirmation.
- Completed work: The batch payment check remains available; operators may check one pending order by `ref1`, including older orders outside the configured batch date window and orders left in processing by an earlier run. Receipt-processing results now include the PostReceipt response or safe failure diagnostic.
- Pending work: Deploy the gateway API change and monitor the first production single-order request.
- Known risks: A manual single-order check intentionally supersedes an existing processing claim for that ref1; operators should not manually check a ref currently being processed by another operator.
- Unresolved issues: The batch endpoint still has a fixed date window by design.
- Next recommended actions: Deploy, then invoke the endpoint for one known pending `ref1` and inspect the response summary.
