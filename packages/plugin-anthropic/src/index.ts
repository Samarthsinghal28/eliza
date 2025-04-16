import { createAnthropic } from '@ai-sdk/anthropic';
import type {
  GenerateTextParams,
  Plugin,
  ObjectGenerationParams,
  IAgentRuntime,
  IInstrumentationService,
  ServiceTypeName,
  ModelTypeName,
} from '@elizaos/core';
import {
  ModelType,
  logger,
  safeReplacer,
  ServiceType,
  InstrumentationService,
} from '@elizaos/core';
import { generateObject, generateText } from 'ai';
import { SpanStatusCode, trace, type Span, context } from '@opentelemetry/api';
import { extractAndParseJSON, ExtractedJSON, ensureReflectionProperties } from './utils';

/**
 * Helper function to get tracer if instrumentation is enabled
 */
function getTracer(runtime: IAgentRuntime) {
  const instrumentationService = runtime.getService<InstrumentationService>(
    ServiceType.INSTRUMENTATION
  );
  if (!instrumentationService?.isEnabled()) {
    return null;
  }
  return instrumentationService.getTracer('eliza.llm.anthropic');
}

/**
 * Helper function to start an LLM span
 */
async function startLlmSpan<T>(
  runtime: IAgentRuntime,
  spanName: string,
  attributes: Record<string, any>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = getTracer(runtime);
  if (!tracer) {
    // If tracing disabled, execute function directly
    const dummySpan = {
      setAttribute: () => {},
      setAttributes: () => {},
      addEvent: () => {},
      recordException: () => {},
      setStatus: () => {},
      end: () => {},
      spanContext: () => ({ traceId: '', spanId: '', traceFlags: 0 }),
    } as unknown as Span;
    return fn(dummySpan);
  }

  const activeContext = context.active();
  return tracer.startActiveSpan(spanName, { attributes }, activeContext, async (span: Span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.end();
      throw error;
    }
  });
}

/**
 * Helper function to get settings with fallback to process.env
 */
function getSetting(
  runtime: IAgentRuntime,
  key: string,
  defaultValue?: string
): string | undefined {
  const setting = runtime.getSetting(key);
  if (setting !== null && setting !== undefined) {
    return String(setting);
  }
  return process.env[key] ?? defaultValue;
}

/**
 * Helper function to get the API key for Anthropic
 */
function getApiKey(runtime: IAgentRuntime): string | undefined {
  return getSetting(runtime, 'ANTHROPIC_API_KEY');
}

/**
 * Helper function to get the small model name with fallbacks
 */
function getSmallModel(runtime: IAgentRuntime): string {
  return (
    getSetting(runtime, 'ANTHROPIC_SMALL_MODEL') ??
    getSetting(runtime, 'SMALL_MODEL', 'claude-3-haiku-20240307')
  );
}

/**
 * Helper function to get the large model name with fallbacks
 */
function getLargeModel(runtime: IAgentRuntime): string {
  return (
    getSetting(runtime, 'ANTHROPIC_LARGE_MODEL') ??
    getSetting(runtime, 'LARGE_MODEL', 'claude-3-5-sonnet-latest') // Use claude-3.5-sonnet as default large
  );
}

/**
 * Plugin for Anthropic.
 *
 * @type {Plugin}
 * @property {string} name - The name of the plugin.
 * @property {string} description - The description of the plugin.
 * @property {Object} config - The configuration object with API keys and model variables.
 * @property {Function} init - Initializes the plugin with the given configuration.
 * @property {Function} models - Contains functions for generating text using small and large models.
 * @property {Function[]} tests - An array of test functions for the plugin.
 */
export const anthropicPlugin: Plugin = {
  name: 'anthropic',
  description: 'Anthropic plugin (supports text generation only)',
  config: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_SMALL_MODEL: process.env.ANTHROPIC_SMALL_MODEL,
    ANTHROPIC_LARGE_MODEL: process.env.ANTHROPIC_LARGE_MODEL,
  },
  async init(config: Record<string, string>) {
    try {
      // If API key is not set, we'll show a warning but continue
      if (!process.env.ANTHROPIC_API_KEY) {
        logger.warn(
          'ANTHROPIC_API_KEY is not set in environment - Anthropic functionality will be limited'
        );
        // Return early without throwing an error
        return;
      }
    } catch (error) {
      // Convert to warning instead of error
      logger.warn(
        `Anthropic plugin configuration issue: ${error} - You need to configure the ANTHROPIC_API_KEY in your environment variables`
      );
    }
  },
  models: {
    [ModelType.TEXT_SMALL]: async (runtime, { prompt, stopSequences = [] }: GenerateTextParams) => {
      const temperature = 0.7;
      const smallModel = runtime.getSetting('ANTHROPIC_SMALL_MODEL') ?? 'claude-3-haiku-20240307';
      const maxTokens = smallModel.includes('-3-') ? 4096 : 8192;

      const { text } = await generateText({
        model: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(smallModel),
        prompt,
        system: runtime.character.system ?? undefined,
        temperature,
        maxTokens,
        stopSequences,
      });
      return text;
    },

    // TEXT_LARGE generation using Anthropics (e.g. using a "claude-3" model).
    [ModelType.TEXT_LARGE]: async (
      runtime,
      {
        prompt,
        maxTokens = 8192,
        stopSequences = [],
        temperature = 0.7,
        frequencyPenalty = 0.7,
        presencePenalty = 0.7,
      }: GenerateTextParams
    ) => {
      const largeModel = runtime.getSetting('ANTHROPIC_LARGE_MODEL') ?? 'claude-3-5-sonnet-latest';

      const { text } = await generateText({
        model: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(largeModel),
        prompt,
        system: runtime.character.system ?? undefined,
        temperature,
        maxTokens,
        stopSequences,
      });
      return text;
    },

    [ModelType.OBJECT_SMALL]: async (runtime, params: ObjectGenerationParams) => {
      const apiKey = getApiKey(runtime);
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

      const smallModel = getSmallModel(runtime);
      const temperature = params.temperature ?? 0;
      const schemaPresent = !!params.schema; // Check if schema was passed

      const systemPrompt = `You are an expert at generating JSON objects. Generate a valid JSON object that strictly adheres to the following constraints:
${params.schema ? `It must match this JSON schema: ${JSON.stringify(params.schema, null, 2)}` : 'No specific schema provided, generate a reasonable JSON object based on the prompt.'}
Only output the JSON object, with no preamble or explanation.`;
      const jsonPrompt = params.prompt;

      // --- Start Instrumentation ---
      const attributes = {
        'llm.vendor': 'Anthropic',
        'llm.request.type': 'object_generation', // Indicate intent
        'llm.request.model': smallModel,
        'llm.request.temperature': temperature,
        'llm.request.schema_present': schemaPresent,
        // 'llm.request.max_tokens': ..., // Consider adding max_tokens
      };

      return startLlmSpan(runtime, 'LLM.generateObject', attributes, async (span) => {
        // Log the prompt intended for object generation
        span.addEvent('llm.prompt', {
          'prompt.content': jsonPrompt,
          'prompt.system': systemPrompt,
        });
        if (schemaPresent) {
          span.addEvent('llm.request.schema', {
            schema: JSON.stringify(params.schema, safeReplacer()),
          });
        }

        let rawTextResult: string | undefined;
        let usageData:
          | { promptTokens: number; completionTokens: number; totalTokens: number }
          | undefined;
        let finishReasonData: string | undefined;

        try {
          // Generate text potentially containing JSON
          const result = await generateText({
            model: createAnthropic({ apiKey })(smallModel),
            prompt: jsonPrompt,
            system: systemPrompt,
            temperature: temperature,
            // maxTokens: ..., // Consider setting for object generation
          });

          rawTextResult = result.text;
          usageData = result.usage;
          finishReasonData = result.finishReason;

          // Log raw text before parsing attempt
          span.addEvent('llm.response.raw_text', { 'response.content': rawTextResult });
          if (usageData) {
            span.setAttributes({
              'llm.usage.prompt_tokens': usageData.promptTokens,
              'llm.usage.completion_tokens': usageData.completionTokens,
              'llm.usage.total_tokens': usageData.totalTokens,
            });
          }
          if (finishReasonData) {
            span.setAttribute('llm.response.finish_reason', finishReasonData);
          }

          // Attempt to parse JSON from the text response
          const processedObject = extractAndParseJSON(rawTextResult);

          if (processedObject.status === 'error') {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `Failed to parse JSON: ${processedObject.error}`,
            });
            span.setAttribute('error.parse.message', processedObject.error);
            // Re-throw or handle error appropriately - throwing allows startLlmSpan to catch it
            throw new Error(
              `Failed to parse JSON: ${processedObject.error}. Raw text: ${rawTextResult}`
            );
          }

          span.addEvent('llm.response.processed', {
            'response.object': JSON.stringify(processedObject, safeReplacer()),
          });
          span.setAttribute('llm.response.processed.extracted_from_raw', true);

          return processedObject;
        } catch (error) {
          // Log specific error message if available
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(
            `[Anthropic] Error in OBJECT_SMALL generation/parsing for model ${smallModel}: ${errorMessage}`
          );

          // Check if the error is likely from JSON parsing
          if (rawTextResult !== undefined && errorMessage.toLowerCase().includes('json')) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `Failed to parse JSON: ${errorMessage}`,
            });
            span.setAttribute('error.type', 'json_parsing');
            span.addEvent('llm.response.raw_text_on_parse_error', {
              'response.content': rawTextResult,
            });
          } else if (rawTextResult !== undefined) {
            // Log raw text if error happened during API call itself
            span.addEvent('llm.response.raw_text_on_api_error', {
              'response.content': rawTextResult,
            });
          }
          // Let startLlmSpan handle recording exception and final status
          throw error;
        }
      });
      // --- End Instrumentation ---
    },

    [ModelType.OBJECT_LARGE]: async (runtime, params: ObjectGenerationParams) => {
      const apiKey = getApiKey(runtime);
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

      const largeModel = getLargeModel(runtime);
      const temperature = params.temperature ?? 0;
      const schemaPresent = !!params.schema;

      const systemPrompt = `You are an expert at generating JSON objects. Generate a valid JSON object that strictly adheres to the following constraints:
${params.schema ? `It must match this JSON schema: ${JSON.stringify(params.schema, null, 2)}` : 'No specific schema provided, generate a reasonable JSON object based on the prompt.'}
Only output the JSON object, with no preamble or explanation.`;
      const jsonPrompt = params.prompt;

      // --- Start Instrumentation ---
      const attributes = {
        'llm.vendor': 'Anthropic',
        'llm.request.type': 'object_generation',
        'llm.request.model': largeModel,
        'llm.request.temperature': temperature,
        'llm.request.schema_present': schemaPresent,
        // 'llm.request.max_tokens': ...,
      };

      return startLlmSpan(runtime, 'LLM.generateObject', attributes, async (span) => {
        span.addEvent('llm.prompt', {
          'prompt.content': jsonPrompt,
          'prompt.system': systemPrompt,
        });
        if (schemaPresent) {
          span.addEvent('llm.request.schema', {
            schema: JSON.stringify(params.schema, safeReplacer()),
          });
        }

        let rawTextResult: string | undefined;
        let usageData:
          | { promptTokens: number; completionTokens: number; totalTokens: number }
          | undefined;
        let finishReasonData: string | undefined;

        try {
          const result = await generateText({
            model: createAnthropic({ apiKey })(largeModel),
            prompt: jsonPrompt,
            system: systemPrompt,
            temperature: temperature,
            // maxTokens: ...,
          });

          rawTextResult = result.text;
          usageData = result.usage;
          finishReasonData = result.finishReason;

          span.addEvent('llm.response.raw_text', { 'response.content': rawTextResult });
          if (usageData) {
            span.setAttributes({
              'llm.usage.prompt_tokens': usageData.promptTokens,
              'llm.usage.completion_tokens': usageData.completionTokens,
              'llm.usage.total_tokens': usageData.totalTokens,
            });
          }
          if (finishReasonData) {
            span.setAttribute('llm.response.finish_reason', finishReasonData);
          }

          // Attempt to parse JSON from the text response
          const processedObject = extractAndParseJSON(rawTextResult);

          if (processedObject.status === 'error') {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `Failed to parse JSON: ${processedObject.error}`,
            });
            span.setAttribute('error.parse.message', processedObject.error);
            throw new Error(
              `Failed to parse JSON: ${processedObject.error}. Raw text: ${rawTextResult}`
            );
          }

          span.addEvent('llm.response.processed', {
            'response.object': JSON.stringify(processedObject, safeReplacer()),
          });
          span.setAttribute('llm.response.processed.extracted_from_raw', true);

          return processedObject;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(
            `[Anthropic] Error in OBJECT_LARGE generation/parsing for model ${largeModel}: ${errorMessage}`
          );
          if (rawTextResult !== undefined) {
            span.addEvent('llm.response.raw_text_on_error', { 'response.content': rawTextResult });
          }
          throw error;
        }
      });
      // --- End Instrumentation ---
    },
  },
  tests: [
    {
      name: 'anthropic_plugin_tests',
      tests: [
        {
          name: 'anthropic_test_text_small',
          fn: async (runtime) => {
            try {
              const text = await runtime.useModel(ModelType.TEXT_SMALL, {
                prompt: 'What is the nature of reality in 10 words?',
              });
              if (text.length === 0) {
                throw new Error('Failed to generate text');
              }
              logger.log('generated with test_text_small:', text);
            } catch (error) {
              logger.error('Error in test_text_small:', error);
              throw error;
            }
          },
        },
        {
          name: 'anthropic_test_text_large',
          fn: async (runtime) => {
            try {
              const text = await runtime.useModel(ModelType.TEXT_LARGE, {
                prompt: 'What is the nature of reality in 10 words?',
              });
              if (text.length === 0) {
                throw new Error('Failed to generate text');
              }
              logger.log('generated with test_text_large:', text);
            } catch (error) {
              logger.error('Error in test_text_large:', error);
              throw error;
            }
          },
        },
        {
          name: 'anthropic_test_object_with_code_blocks',
          fn: async (runtime) => {
            try {
              const result = await runtime.useModel(ModelType.OBJECT_SMALL, {
                prompt: 'Give me instructions to install Node.js',
                schema: { type: 'object' },
              });
              logger.log('Generated object with code blocks:', result);
              if (!result || result.error) {
                throw new Error('Failed to generate object with code blocks');
              }
            } catch (error) {
              logger.error('Error in test_object_with_code_blocks:', error);
              throw error;
            }
          },
        },
      ],
    },
  ],
};

export default anthropicPlugin;
