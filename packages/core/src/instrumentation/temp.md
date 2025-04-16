# Eliza Core Instrumentation Analysis and Implementation Checklist

Based on the comprehensive requirements in `requirements.md` and the current implementation in `runtime.ts`, here's an analysis of what's done and what remains to be implemented.

## Core Instrumentation Infrastructure

| Item                               | Status  | Implementation Notes                                                      |
| ---------------------------------- | ------- | ------------------------------------------------------------------------- |
| Initialize instrumentation service | ✅ Done | Implemented in `constructor` of `AgentRuntime`                            |
| Create `startSpan` helper method   | ✅ Done | Handles context, error handling, status setting, and graceful degradation |
| Service enablement logic           | ✅ Done | Now correctly enabled only when `POSTGRES_URL_INSTRUMENTATION` is set     |

## 1. Runtime Core Logic Instrumentation

| Item                                   | Status            | Implementation Notes                                                                                                     |
| -------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Wrap primary message processing logic  | ⚠️ Partially Done | `evaluate` and `processActions` are wrapped, but missing a single top-level span that encapsulates an entire interaction |
| Set essential attributes on spans      | ✅ Done           | `agent.id`, `character.name`, `room.id`, `message.id`, etc. are set where applicable                                     |
| Add key event milestones               | ✅ Done           | Events like `evaluation_started`, `state_composition_started`, etc. are added                                            |
| Instrument lifecycle methods           | ✅ Done           | `initialize` and `stop` methods are instrumented                                                                         |
| Instrument plugin/service registration | ✅ Done           | `registerPlugin`, `registerService`, etc. are instrumented                                                               |

**Remaining Work:**

- **Top-level interaction span**: Identify the top-level method that initiates a user interaction flow (the entry point that calls `evaluate` or processes a message). This method needs to be wrapped in a span that becomes the parent for the entire interaction trace.
  - **Implementation approach**: Look for methods like `handleMessage`, `processInteraction`, or similar in `runtime.ts`. This would likely be a public method that external systems call to initiate interaction with the agent.
  - **Required**: Yes, crucial for proper trace hierarchy.

## 2. Context Composition Instrumentation (`composeState`)

| Item                                  | Status      | Implementation Notes                                             |
| ------------------------------------- | ----------- | ---------------------------------------------------------------- |
| Wrap `composeState` logic             | ✅ Done     | Method wrapped with `AgentRuntime.composeState` span             |
| Log input parameters                  | ✅ Done     | `filterList`, `includeList` logged as attributes                 |
| Log provider data                     | ✅ Done     | Provider counts, names logged; nested spans for provider fetches |
| Log final composed context            | ✅ Done     | Logged as `state_composed` event with truncation and length      |
| Log prompt template name/ID           | ❌ Not Done | Template information not captured                                |
| Log detailed memory/knowledge sources | ❌ Not Done | Specific IDs and details of memories/knowledge not logged        |

**Remaining Work:**

1. **Prompt template logging**:

   - **Implementation approach**: Add to `composeState` if template selection happens there. If templates are selected elsewhere, a note should be added to document this limitation.
   - **Required**: Medium priority - helpful for debugging but may not be applicable if templates are selected outside `composeState`.

2. **Detailed memory/knowledge source logging**:
   - **Implementation approach**: Enhance `composeState` to log more specific details about the data sources used beyond just provider names. This would involve adding events for memory IDs, knowledge item IDs, etc., when available.
   - **Required**: Medium priority - helpful for detailed debugging but increases logging volume.

## 3. LLM API Calls Instrumentation (`useModel`)

| Item                   | Status            | Implementation Notes                                                                                                                 |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Wrap `useModel` logic  | ✅ Done           | Wrapped with `AgentRuntime.useModel.${modelType}` span                                                                               |
| Log LLM parameters     | ⚠️ Partially Done | Added some key parameters (`model`, `temperature`, `top_p`, `max_tokens`), but missing vendor and other potentially important params |
| Log final prompt       | ⚠️ Partially Done | Attempts extraction from common params, needs verification                                                                           |
| Log raw API response   | ❌ Not Done       | Cannot be implemented in `useModel` - requires model handler changes                                                                 |
| Log processed response | ✅ Done           | Logged as `model_response` event                                                                                                     |
| Log token usage        | ⚠️ Partially Done | Added speculatively, needs verification/standards                                                                                    |

**Remaining Work:**

1. **Complete LLM parameter logging**:

   - **Implementation approach**: Add additional attributes in `useModel` for other common parameters (frequency penalty, presence penalty, etc.). Standardize naming using OTel conventions.
   - **Required**: Medium priority - primary parameters are captured.

2. **Improve prompt logging**:

   - **Implementation approach**: Enhance prompt extraction logic in `useModel` to better handle different model parameter formats.
   - **Required**: Medium priority - basic extraction is working but could be improved.

3. **Raw API response logging**:

   - **Implementation approach**: Cannot be implemented in `runtime.ts` - requires changes to specific model handlers/plugins that make the actual API calls.
   - **Required**: High priority for debugging, but must be implemented in model plugins (e.g., @elizaos/plugin-openai).

4. **Standardize token usage logging**:
   - **Implementation approach**: Validate and standardize token usage attribute extraction based on actual API response structures.
   - **Required**: Medium priority - speculative implementation exists.

## 4. Action Execution Instrumentation (`processActions`)

| Item                                 | Status  | Implementation Notes                                          |
| ------------------------------------ | ------- | ------------------------------------------------------------- |
| Wrap overall `processActions` method | ✅ Done | Method wrapped with `AgentRuntime.processActions` span        |
| Wrap individual action handlers      | ✅ Done | Each handler wrapped with `Action.${action.name}` span        |
| Set `action.name` attribute          | ✅ Done | Attribute set on individual action spans                      |
| Log input parameters                 | ✅ Done | Logged as `action.input` event with message ID and state keys |
| Log output/status                    | ✅ Done | Logged as `action.output` event with success/error status     |

**Remaining Work:**

- All requirements for action execution instrumentation appear to be implemented.
- **Optional enhancement**: Consider logging more specific output data from action handlers if available, not just success/error status.
  - **Implementation approach**: Enhance the action handling try/catch block to extract and log meaningful return values when possible.
  - **Required**: Low priority - core requirements are met.

## Additional Missing Items Not Explicitly Required

| Item                       | Status      | Implementation Notes                                            |
| -------------------------- | ----------- | --------------------------------------------------------------- |
| Metric collection          | ❌ Not Done | MeterProvider initialized but no specific metrics exported      |
| UI for trace visualization | ❌ Not Done | Outside the scope of `runtime.ts` - would be a separate project |

**Remaining Work:**

1. **Metric collection**:

   - **Implementation approach**: Define and implement specific metrics in `runtime.ts` using the `getMeter()` method.
   - **Required**: Low priority - not explicitly required in current instrumentation requirements.

2. **Trace visualization UI**:
   - **Implementation approach**: Not applicable to `runtime.ts` - would be a separate frontend project.
   - **Required**: Outside the scope of current requirements for `runtime.ts`.

## Implementation Priorities

Based on the analysis, I recommend prioritizing these remaining items in the following order:

1. **Top-level interaction span** - Critical for proper trace hierarchy
2. **Raw API response logging in model plugins** - Important for debugging LLM calls
3. **Enhanced prompt template and data source logging** - Helpful for deeper understanding of context composition
4. **Standardization and completion of LLM parameter logging** - Refinement of existing implementation

The overall instrumentation is already quite thorough, with most high-priority items implemented. The remaining work mostly involves refinements and addressing specific gaps in the instrumentation coverage.
