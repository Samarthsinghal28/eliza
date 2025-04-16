Epic: Implement Comprehensive OpenTelemetry Logging & Frontend Tracing UI for Eliza V2

Dependencies:

Ticket: Backend - Implement Core Instrumentation Service: This ticket relies on the successful implementation of the InstrumentationService within @elizaos/core and its registration within AgentRuntime. The getTracer() method provided by that service is essential.

Description:

This ticket focuses on adding OpenTelemetry spans to the core processing logic within the AgentRuntime class in @elizaos/core. The goal is to create a foundational trace structure for each user interaction or significant runtime event, capturing its overall duration, key identifiers, and outcome (success/error). This provides the top-level context for more granular instrumentation added in subsequent tasks (like context composition, LLM calls, and action execution).

Tasks & Implementation Details:

Identify Core Processing Entry Point(s):

Locate the primary method(s) in packages/core/src/runtime.ts (AgentRuntime class) that handle incoming user messages or initiate significant agent processing cycles. This might be a method like processMessage, handleEvent, or similar.

Identify methods related to the start and end of a processing "run" if explicit ones exist (e.g., potentially related to EventType.RUN_STARTED, EventType.RUN_ENDED).

Obtain Tracer:

Within the identified method(s), retrieve the OTel Tracer instance at the beginning of the execution path:

const instrumentationService = this.getService<InstrumentationService>(ServiceType.INSTRUMENTATION); // Or "INSTRUMENTATION" string key
const tracer = instrumentationService?.getTracer('eliza.core.runtime'); // Use a descriptive tracer name
if (!tracer || !instrumentationService?.isEnabled()) {
// If instrumentation is disabled or service unavailable, proceed without tracing
// ... original method logic ...
return;
}

Create Root Span for Interaction:

Wrap the entire core processing logic of the identified entry point method(s) within a root OTel span.

Start Span: const rootSpan = tracer.startSpan('AgentRuntime.processInteraction'); (or a more specific name like AgentRuntime.handleUserMessage).

Context Propagation: Ensure the span operates within the correct OTel context (the SDK often handles this automatically with startSpan, but review if manual context setting like context.with(trace.setSpan(context.active(), rootSpan), () => { ... }) is needed, especially for async operations).

Set Essential Attributes:

Immediately after starting the span, set crucial identifying attributes:

rootSpan.setAttributes({
'agent.id': this.agentId,
'character.name': this.character?.name,
'room.id': message?.roomId || 'unknown', // Extract from input message/event
'user.id': message?.userId || 'unknown', // Extract from input message/event
'message.id': message?.id || 'unknown', // Extract from input message/event
// Add any other relevant high-level identifiers available
});

Add Key Events:

Add span events (rootSpan.addEvent('eventName', { attributes })) at significant milestones within the core logic, for example:

run_started (if matching EventType.RUN_STARTED)

processing_started

action_loop_started (if applicable)

response_generation_started (if applicable)

run_ended (if matching EventType.RUN_ENDED)

Implement Error Handling:

Wrap the main logic block within a try...catch...finally statement.

In catch (error):

Record the exception on the span: rootSpan.recordException(error as Error);

Set the span status to Error: rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });

Re-throw the error to maintain original application flow: throw error;

In finally:

Ensure the span is always ended: rootSpan.end();

Set Success Status:

If the processing completes successfully (before the finally block or before returning), set the span status to OK: rootSpan.setStatus({ code: SpanStatusCode.OK });

(Optional) Instrument Start/Stop Methods:

If AgentRuntime has distinct start() or stop() lifecycle methods, add similar spans around their logic to trace the agent's overall lifecycle.

Acceptance Criteria:

The primary message/event processing method(s) in AgentRuntime are wrapped with a root OpenTelemetry span when instrumentation is enabled.

The root span correctly captures essential attributes: agent.id, character.name, room.id, user.id, message.id.

The root span's start and end times accurately reflect the duration of the core processing logic.

Errors occurring within the core processing logic are recorded on the root span using recordException, and the span status is set to ERROR.

Successful completion sets the root span status to OK.

The root span is correctly ended in all execution paths (success and error).

Instrumentation code gracefully handles cases where the InstrumentationService is disabled or unavailable (e.g., does not crash, proceeds with original logic).

Code compiles successfully and existing tests pass.

Trace data (viewed via Console exporter or OTLP backend) shows the root spans with correct attributes and status for different interactions.

Epic: Implement Comprehensive OpenTelemetry Logging & Frontend Tracing UI for Eliza V2

Dependencies:

Ticket: Backend - Implement Core Instrumentation Service: Requires the InstrumentationService to be available and registered in AgentRuntime to provide a Tracer.

Ticket: Backend - Instrument Runtime Core Logic: Assumes a parent span (e.g., for the overall interaction) might exist, allowing this context composition span to be nested correctly.

Description:

This ticket focuses on adding detailed OpenTelemetry instrumentation to the specific function(s) within @elizaos/core (likely in AgentRuntime or a related module) that are responsible for assembling the context provided to the Large Language Model (LLM). Capturing this process is crucial for understanding prompt engineering, debugging context-related issues, and meeting the goals of Ticket #196.

Tasks & Implementation Details:

Identify Context Composition Function(s):

Locate the V2 function(s) in packages/core/src/runtime.ts or related files that perform the core logic of gathering data (memories, knowledge, state, character info, etc.) and formatting it into the final context string used for generating the LLM prompt. This might be a method like composeState, getContext, buildPromptContext, or similar.

Obtain Tracer:

Within the identified function(s), retrieve the OTel Tracer instance, typically via the InstrumentationService accessed from the AgentRuntime instance.

const instrumentationService = runtime.getService<InstrumentationService>(ServiceType.INSTRUMENTATION); // Or string key
const tracer = instrumentationService?.getTracer('eliza.core.context'); // Descriptive tracer name
if (!tracer || !instrumentationService?.isEnabled()) {
// Proceed without tracing if disabled
// ... original function logic ...
return originalResult;
}

Create Context Composition Span:

Wrap the entire logic of the context composition function(s) within an OTel span.

Start Span: const contextSpan = tracer.startSpan('Context.compose'); (or similar).

Ensure correct OTel context propagation if necessary (usually handled by startSpan).

Log Input Sources (Attributes/Events):

As different data sources are fetched or processed (e.g., recent messages, knowledge, facts, agent state, character bio), log their presence and potentially key metadata as attributes or events on the contextSpan.

Example Attributes:

contextSpan.setAttributes({
'context.sources.memory.count': recentMessages.length,
'context.sources.knowledge.count': knowledgeSnippets.length,
'context.sources.facts.count': relevantFacts.length,
'context.sources.state_keys': JSON.stringify(Object.keys(agentState)), // Log keys, not full state potentially
'context.sources.character_config_present': !!characterConfig,
// Add other relevant source indicators
});

Example Events (for larger data):

// Log fetched message IDs
contextSpan.addEvent('context.source.memory_fetched', { 'message.ids': JSON.stringify(recentMessages.map(m => m.id)) });
// Log knowledge source identifiers if available
contextSpan.addEvent('context.source.knowledge_fetched', { 'knowledge.ids': JSON.stringify(knowledgeSnippets.map(k => k.id)) });

Decision Point: Determine the right balance between attributes (easily queryable, potentially limited size) and events (can hold more complex/larger data) for logging input source details. Avoid logging excessively large or sensitive data directly as attributes.

Log Template Information:

Log the name or identifier of the prompt template(s) being used as a span attribute.

contextSpan.setAttribute('context.template.name', templateName);
// Optionally log template content as an event if needed for debugging, respecting size
// contextSpan.addEvent('context.template.content', { 'template.content': templateContent });

Log Final Composed Context:

Log the final assembled context string just before it's returned or used to build the LLM prompt. Use a span event due to potential length.

// Consider truncating if necessary
const truncatedContext = finalContextString.length > 1000 ? finalContextString.substring(0, 997) + '...' : finalContextString;
contextSpan.addEvent('context.composed', {
'context.final_string': truncatedContext, // Log truncated string
'context.final_length': finalContextString.length // Log original length
});

Implement Error Handling:

Wrap the logic in try...catch...finally.

In catch (error): Record exception, set status to ERROR.

In finally: End the span: contextSpan.end();.

Set Success Status:

On successful completion, set span status to OK.

Acceptance Criteria:

The core context composition function(s) in @elizaos/core are wrapped with a dedicated OpenTelemetry span when instrumentation is enabled.

The span captures attributes or events indicating which data sources (memory, knowledge, state, character config, etc.) were accessed or used.

The span captures the name/identifier of the template(s) used.

The span captures the final composed context string as an event (potentially truncated, with original length noted).

Errors occurring during context composition are recorded on the span using recordException, and the span status is set to ERROR.

Successful composition sets the span status to OK.

The context composition span is correctly ended in all execution paths.

The span is correctly nested within the parent interaction span (from the Runtime Core Logic ticket).

Trace data shows the context composition span with relevant attributes/events.

Epic: Implement Comprehensive OpenTelemetry Logging & Frontend Tracing UI for Eliza V2

Dependencies:

Ticket: Backend - Implement Core Instrumentation Service: Requires the InstrumentationService to be available and registered in AgentRuntime to provide a Tracer.

Ticket: Backend - Instrument Runtime Core Logic: Assumes a parent span exists for the overall interaction.

Ticket: Backend - Instrument Context Composition: Assumes the prompt generation process might occur before this step.

Description:

This ticket focuses on adding detailed OpenTelemetry instrumentation around the specific functions within @elizaos/core or relevant LLM plugins (like @elizaos/plugin-openai, @elizaos/plugin-anthropic, etc.) that make external API calls to Large Language Models (LLMs). Capturing details about these calls (parameters, prompts, responses) is essential for debugging model behavior, analyzing costs, understanding latency, and meeting the goals of Tickets #196 and #377.

Tasks & Implementation Details:

Identify Target LLM Call Functions:

Locate the primary V2 functions responsible for executing calls to external LLM APIs. Examples include wrappers around generateText, generateObject from the ai library, or custom fetch/API client calls within specific LLM plugins (e.g., inside packages/plugin-openai/src/index.ts).

Obtain Tracer:

Within the identified wrapper functions, retrieve the OTel Tracer instance via the InstrumentationService.

const instrumentationService = runtime.getService<InstrumentationService>(ServiceType.INSTRUMENTATION); // Or string key
const tracer = instrumentationService?.getTracer('eliza.llm.api'); // Descriptive name (e.g., 'eliza.llm.openai')
if (!tracer || !instrumentationService?.isEnabled()) {
// Proceed without tracing if disabled
// ... original function logic ...
return originalResult;
}

Create LLM Call Span:

Wrap the entire logic of the LLM API call (including parameter preparation, the call itself, and response processing) within an OTel span.

Start Span: const llmSpan = tracer.startSpan('LLM.generateText'); (or LLM.generateObject, LLM.callApi). Use semantic conventions where possible (e.g., llm.request).

Log Call Parameters (Attributes):

Set attributes on the llmSpan for all key parameters influencing the LLM's behavior. Use OpenTelemetry semantic conventions for LLMs where available/applicable (llm.\* attributes).

llmSpan.setAttributes({
'llm.request.model': modelName, // e.g., 'gpt-4o-mini'
'llm.vendor': 'OpenAI', // Or 'Anthropic', etc.
'llm.request.type': 'completion', // Or 'chat', 'embedding', etc.
'llm.temperature': temperature,
'llm.top_p': topP,
'llm.max_tokens': maxTokens,
'llm.frequency_penalty': frequencyPenalty,
'llm.presence_penalty': presencePenalty,
'llm.stop_sequences': JSON.stringify(stopSequences), // Stringify arrays
// Add any other relevant parameters (e.g., tool configuration, JSON mode)
});

Log Final Prompt (Event):

Log the exact final prompt string sent to the LLM API as a span event due to its potential length.

// Consider truncating for display previews if needed, but log full length if possible
llmSpan.addEvent('llm.prompt', { 'prompt.content': finalPromptString });

Execute LLM Call within Try/Catch:

Perform the actual network request to the LLM API within a try...catch block.

Log Raw Response (Event):

Inside the try block, after receiving a successful response from the API but before extensive parsing, log the complete raw response body (e.g., JSON string) as a span event. This is crucial for debugging API contract issues or unexpected formats.

const rawResponseBody = await response.text(); // or response.json() then stringify
// Consider truncating for display previews if needed
llmSpan.addEvent('llm.response.raw', { 'response.body': rawResponseBody });

Log Processed Response (Attribute/Event):

Log the final, processed data returned by the wrapper function (e.g., the extracted text or the parsed object) as an attribute (if short) or an event (if long/complex).

// If text response:
llmSpan.setAttribute('llm.response.processed.length', processedTextResponse.length);
// Optionally log truncated text as event:
// llmSpan.addEvent('llm.response.processed', { 'response.content': truncatedText });
// If object response:
llmSpan.addEvent('llm.response.processed', { 'response.object': JSON.stringify(processedObjectResponse) });

Log Usage/Token Counts (Attributes):

If the LLM API response includes token usage information (prompt tokens, completion tokens, total tokens), capture these as attributes.

if (apiResponseData?.usage) {
llmSpan.setAttributes({
'llm.usage.prompt_tokens': apiResponseData.usage.prompt_tokens,
'llm.usage.completion_tokens': apiResponseData.usage.completion_tokens,
'llm.usage.total_tokens': apiResponseData.usage.total_tokens,
});
}

Implement Error Handling:

In catch (error): Record exception (llmSpan.recordException(error)), set status to ERROR (llmSpan.setStatus({ code: SpanStatusCode.ERROR, message: ... })). Include details like API status codes if available.

In finally: End the span (llmSpan.end()).

Set Success Status:

On successful completion (API call succeeded and response processed), set span status to OK.

Acceptance Criteria:

Functions making external LLM API calls are wrapped with a dedicated OpenTelemetry span when instrumentation is enabled.

The span correctly captures attributes for the LLM provider, model name, and all relevant generation parameters (temp, top_p, max_tokens, etc.), ideally using llm.\* semantic conventions.

The exact final prompt sent to the LLM is recorded as a span event.

The raw response body received from the LLM API is recorded as a span event.

The final processed text/object result is recorded as a span attribute or event.

Token usage data (prompt, completion, total), if provided by the API, is recorded as span attributes.

Errors during the API call or response processing are recorded on the span using recordException, and the span status is set to ERROR.

Successful LLM calls result in the span status being set to OK.

The LLM call span is correctly ended in all execution paths.

The span is correctly nested within its parent span (e.g., context composition or core runtime span).

Trace data shows the LLM call span with relevant attributes and events.

## Instrumentation Checklists (Condensed)

**Common Steps (Apply to all):**

- ✅ Obtain OTel Tracer, check if enabled, wrap logic in try/catch/finally, ensure span ends, set status OK/ERROR.

**1. Runtime Core Logic:**

- ✅ Wrap main event handling in a root span (e.g., `AgentRuntime.processInteraction`).
- ✅ Set essential attributes: `agent.id`, `character.name`, `room.id`, `user.id`, `message.id`.
- ✅ Add key events for processing milestones.

**2. Context Composition:**

- ✅ Wrap context building logic in a span (e.g., `Context.compose`).
- ✅ Log data sources used (memory, knowledge, etc.) via attributes/events & log template name/ID.
- ✅ Log final context string (event) and length.

**3. LLM API Calls:**

- ✅ Wrap API call logic in a span (e.g., `LLM.generateText`), setting parameters as attributes (using semantic conventions).
- ✅ Log final prompt (event), raw API response (event), and processed result (attribute/event).
- ✅ Log token usage counts as attributes if available.

**4. Action Execution:**

- ✅ Wrap the overall `processActions` method logic.
- ✅ Wrap _each individual_ action handler invocation within `processActions` in its own dedicated span (e.g., `Action.ACTION_NAME`).
- ✅ Set `action.name` attribute on individual action spans.
- ✅ Log input parameters passed to _each_ action handler (as event `action.input` on individual action spans).
- ✅ Log the output/return value from _each_ action handler (as event `action.output` on individual action spans, logs success/error status).

Okay, I will check `packages/core/src/runtime.ts` against the condensed instrumentation checklists from `old-instrumentation/Readme` to see what's been implemented there.

First, I need to read the contents of `packages/core/src/runtime.ts`.

Read file: packages/core/src/runtime.ts

Okay, let's analyze `packages/core/src/runtime.ts` based on the condensed instrumentation checklists:

**Instrumentation Status in `runtime.ts` (Updated):**

**Done:**

1.  **Common Setup:**
    - Instrumentation service and tracer initialized (`constructor`).
    - `startSpan` helper created (handles context, errors, status, mock span).
2.  **Runtime Core Logic:**
    - `evaluate` method wrapped in a root span (`AgentRuntime.evaluate`) with essential attributes (`agent.id`, `message.id`, etc.) and key processing events.
    - `initialize`, `stop`, `registerPlugin`, `registerService`, `addKnowledge`, `getKnowledge`, `processActions` methods are also wrapped with spans and basic attributes/events.
3.  **Context Composition (`composeState`):**
    - Method wrapped (`AgentRuntime.composeState`).
    - Input parameters (`filterList`, `includeList`) logged as attributes.
    - Details about providers used (counts, names) logged as attributes.
    - Nested spans created for individual provider fetches, logging duration and basic result info.
    - Final composed state text logged as an event (`state_composed`) with truncation and length attribute.
4.  **LLM API Calls (`useModel`):**
    - Method wrapped (`AgentRuntime.useModel.${modelType}`).
    - Key attributes set (`llm.request.model`, `agent.id`, `llm.duration_ms`).
    - Input parameters logged as an event (`model_parameters`).
    - Final response logged as an event (`model_response`).
    - Speculative token usage attributes added (`llm.usage.*`).

**Not Done / Partially Done:**

1.  **Runtime Core Logic:**
    - While many core methods are wrapped, review if any other primary interaction entry points need similar root-level instrumentation (e.g., a method that _calls_ `evaluate` or `processActions`).
2.  **Context Composition (`composeState`):**
    - Template name/ID used is _not_ logged.
    - Detailed logging of specific data sources (e.g., counts/IDs of memories, knowledge items used) is missing.
3.  **LLM API Calls (`useModel`):**
    - Logging the exact final prompt sent to the LLM is missing.
    - Logging the raw API response received _before_ processing is missing.
    - Token usage attribute logging needs verification/standardization based on actual API response structures.
    - Additional semantic attributes (e.g., `llm.vendor`) could be added.

Epic: Implement Comprehensive OpenTelemetry Logging & Frontend Tracing UI for Eliza V2

Dependencies:

Ticket: Backend - Implement Core Instrumentation Service: Requires the InstrumentationService to be available and registered in AgentRuntime to provide a Tracer.

Ticket: Backend - Instrument Runtime Core Logic: Assumes a parent span exists for the overall interaction or the action selection loop.

Description:

This ticket focuses on adding OpenTelemetry instrumentation around the invocation of specific plugin action handlers within the Eliza V2 backend (likely @elizaos/core or AgentRuntime). Capturing the details of each action execution (inputs, outputs, status, errors, duration) is critical for debugging agent behavior, understanding plugin performance, and meeting the goals of Tickets #376 and #377.

Tasks & Implementation Details:

Identify Action Invocation Point:

Locate the code within packages/core/src/runtime.ts (or a potential ActionManager module) where the system resolves an action name (e.g., determined by the LLM) and calls the corresponding handler function provided by a registered plugin.

Obtain Tracer:

Within the action invocation logic (before calling the specific handler), retrieve the OTel Tracer instance via the InstrumentationService.

const instrumentationService = runtime.getService<InstrumentationService>(ServiceType.INSTRUMENTATION); // Or string key
const tracer = instrumentationService?.getTracer('eliza.core.action'); // Descriptive tracer name
if (!tracer || !instrumentationService?.isEnabled()) {
// Proceed without tracing if disabled
// ... original action invocation logic ...
return originalResult;
}

Create Action Execution Span:

For each action handler invocation, create a dedicated OTel span that wraps the call to the handler.

Start Span: Use a dynamic name reflecting the action being executed.

const actionName = actionToExecute.name; // Get the actual action name
const actionSpan = tracer.startSpan(`Action.${actionName}`); // e.g., Action.GITHUB_CREATE_ISSUE

Ensure correct OTel context propagation.

Log Action Name (Attribute):

Set the action name as a primary attribute on the span.

actionSpan.setAttribute('action.name', actionName);

Log Input Parameters (Attribute/Event):

Capture the input parameters (message, state, options) passed to the action handler.

Log them as attributes (if simple and non-sensitive) or as a structured event (preferred for complex objects or potentially sensitive data).

// Option A: Attributes (Simple, Non-sensitive Params) - Example assumes options are simple key-value
// actionSpan.setAttributes({
// 'action.input.options': JSON.stringify(options),
// });
// Option B: Event (More Robust, Handles Complex/Sensitive Data)
const inputData = {
// Omit full 'message' or 'state' content unless specifically needed and sanitized
'message.id': message?.id,
'state.keys': state ? JSON.stringify(Object.keys(state)) : 'undefined', // Log keys only
'options': JSON.stringify(options), // Log full options if safe
};
actionSpan.addEvent('action.input', inputData);

Decision Point: Choose the appropriate logging method based on the complexity and sensitivity of typical action inputs. Prioritize using events for structured objects.

Execute Action Handler within Try/Catch:

Call the actual actionToExecute.handler(...) function within a try...catch block.

Log Output/Return Value (Attribute/Event):

Inside the try block, after the handler successfully returns, log the output.

Use an attribute for simple return values (e.g., boolean success flags) or an event for complex objects/text.

const result = await actionToExecute.handler(...);
// Option A: Attribute (Simple Result)
// if (typeof result === 'boolean' || typeof result === 'number' || typeof result === 'string') {
// actionSpan.setAttribute('action.output.result', result);
// }
// Option B: Event (Complex Result or Standard Practice)
// Consider truncating large text/objects
actionSpan.addEvent('action.output', { 'output.data': JSON.stringify(result) });

Implement Error Handling:

In catch (error):

Record the exception: actionSpan.recordException(error as Error);

Set the span status to Error: actionSpan.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });

Log the specific actionName in the error message for easier debugging in application logs: runtime.runtimeLogger.error(\Error executing action '${actionName}':`, error);`

Re-throw or handle the error as per existing application logic.

In finally:

End the span: actionSpan.end();

Set Success Status:

If the action handler completes without throwing an error (within the try block, before finally), set the span status to OK: actionSpan.setStatus({ code: SpanStatusCode.OK });

Acceptance Criteria:

The logic responsible for invoking plugin action handlers in @elizaos/core is wrapped with a dedicated OpenTelemetry span for each action call when instrumentation is enabled.

The span name correctly reflects the specific action being executed (e.g., Action.GITHUB_CREATE_ISSUE).

The span includes the action.name attribute.

Input parameters passed to the action handler are logged as span attributes or events (balancing detail vs. sensitivity/size).

The output/return value from the action handler is logged as a span attribute or event.

Errors occurring during action execution are recorded on the span using recordException, and the span status is set to ERROR.

Successful action executions result in the span status being set to OK.

The action execution span's start and end times accurately reflect the duration of the handler execution.

The action execution span is correctly ended in all execution paths.

The span is correctly nested within its parent span (e.g., the core runtime or LLM call span that triggered the action).

Trace data shows individual action execution spans with relevant attributes, events, status, and error details.

## Consolidated Instrumentation Requirements Status

**Common Steps (Apply to all):**

- [✅ Done] Obtain OTel Tracer instance (`constructor`).
- [✅ Done] Check if instrumentation is enabled before tracing (`constructor`, `startSpan` helper).
- [✅ Done] Wrap instrumented logic in try/catch/finally (`startSpan` helper handles this implicitly for wrapped functions).
- [✅ Done] Ensure span ends correctly in all paths (success/error) (`startSpan` helper).
- [✅ Done] Set span status to OK/ERROR appropriately (`startSpan` helper).
- [✅ Done] Handle cases where instrumentation is disabled gracefully (mock span provided by `startSpan`).

**1. Runtime Core Logic Instrumentation:**

- [⚠️ Partially Done] Wrap primary message/event processing logic in a root span (e.g., `AgentRuntime.processInteraction`). (`evaluate` and `processActions` are wrapped, but a single top-level interaction span might be missing depending on the exact entry point).
- [✅ Done] Set essential identifying attributes on spans where context is available (`agent.id`, `character.name`, `room.id`, `message.id`, `entity.id`).
- [✅ Done] Add key events for processing milestones within wrapped methods (e.g., `evaluation_started`, `action_execution_complete`).
- [✅ Done] Instrument `initialize` and `stop` methods.

**2. Context Composition Instrumentation (`composeState`):**

- [✅ Done] Wrap `composeState` logic in a span (`AgentRuntime.composeState`).
- [⚠️ Partially Done] Log data sources used (Attributes added for provider names/counts; nested spans for provider fetches added; _pending: detailed memory/knowledge source info_).
- [✅ Done] Log the final composed context string (as event `state_composed`) and its length.

**3. LLM API Calls Instrumentation (`useModel`):**

- [✅ Done] Wrap `useModel` logic in a span (`AgentRuntime.useModel.${modelType}`).
- [⚠️ Partially Done] Set key LLM parameters as span attributes using semantic conventions (`llm.request.model`, `llm.duration_ms`, `llm.request.temperature`, `llm.request.top_p`, `llm.request.max_tokens` added; `llm.vendor` placeholder added; _pending: full parameters like temp, top_p, max_tokens etc. verification/refinement_).
- [⚠️ Partially Done] Log the final prompt sent to the LLM (Event `llm.prompt` added, attempts to extract from common params; _needs verification/refinement based on actual usage_).
- [✅ Done] Log the _processed_ response/result from the model handler (Event `model_response` added).
- [⚠️ Partially Done] Log token usage counts as attributes (`llm.usage.*` attributes added speculatively; _needs verification/standardization based on actual API responses_).

**4. Action Execution Instrumentation (`processActions`):**

- [✅ Done] Wrap the overall `processActions` method logic.
- [✅ Done] Wrap _each individual_ action handler invocation within `processActions` in its own dedicated span (e.g., `Action.ACTION_NAME`).
- [✅ Done] Set `action.name` attribute on individual action spans.
- [✅ Done] Log input parameters passed to _each_ action handler (as event `action.input` on individual action spans).
- [✅ Done] Log the output/return value from _each_ action handler (as event `action.output` on individual action spans, logs success/error status).
