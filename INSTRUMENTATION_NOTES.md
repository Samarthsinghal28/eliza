# OpenTelemetry Instrumentation Issue: AgentRuntime.emitEvent Nesting

## Goal

Instrument `AgentRuntime.emitEvent` in `packages/core/src/runtime.ts` for `MESSAGE_RECEIVED` events. Create a root span (`AgentRuntime.handleMessageEvent`) that acts as the parent for subsequent internal runtime operations (like `composeState`, `useModel`, `processActions`).

## Problem

Using `tracer.startSpan()` or the attempted `tracer.startActiveSpan()` wrapper in `registerEvent` successfully creates the `AgentRuntime.handleMessageEvent` span, but internal operation spans appear sequentially in traces, **not nested** under it.

## Cause

Automatic OpenTelemetry context propagation seems to be failing across the `async` event handlers invoked via `emitEvent` (potentially due to `Promise.all` or other async patterns). Therefore, spans created inside those handlers don't recognize `AgentRuntime.handleMessageEvent` as their active parent.

## Solution Attempt (`startActiveSpan`) & Blocker

The correct method to ensure context propagation and proper nesting is `tracer.startActiveSpan()`. However, multiple attempts to refactor `emitEvent` or `registerEvent` using this method via automated edits resulted in significant **structural corruption** of the `AgentRuntime` class file (`runtime.ts`), leading to many unrelated linter errors. The automated refactoring failed due to the complexity of the necessary changes.

## Current Status

- Instrumentation uses `tracer.startSpan()` within a wrapper in `registerEvent`.
- The root span `AgentRuntime.handleMessageEvent` is generated.
- **Limitation:** Trace hierarchy (nesting) is incorrect due to context propagation issues with async handlers.

## Recommendations

1.  **Accept Limitation:** Keep the current `startSpan` implementation for top-level visibility without nesting. The core span exists, providing value, even if the hierarchy isn't perfect.
2.  **Manual Refactor:** Manually refactor `registerEvent` (or `emitEvent`) to correctly use `tracer.startActiveSpan`, ensuring the wrapper properly manages the async context for the original handler. This is the ideal OTel solution but requires careful implementation to avoid the structural issues encountered by the automated tooling.
3.  **Manual Context Propagation (Workaround - Not Recommended):** Modify the `registerEvent` wrapper to pass the `rootSpan` or its `context` explicitly to the original handler (e.g., `handler(params, spanContext)`). Handlers would then need to be modified to accept this context and use it when creating child spans. **Downsides:** Breaking changes to handler signatures/params, tight coupling, complexity, deviates from standard OTel practices.
4.  **Instrument Handlers Directly:** A variant of #2, where instrumentation logic (using `startActiveSpan`) is added directly _within_ each primary `MESSAGE_RECEIVED` handler function instead of using a wrapper in `registerEvent`. This avoids modifying `registerEvent` but decentralizes the instrumentation logic.
