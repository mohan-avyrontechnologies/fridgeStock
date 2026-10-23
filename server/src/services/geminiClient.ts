import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';
import type { AiClient, AiUsage } from './aiClient.js';

/** The slice of the Gemini SDK this client uses (replaceable in tests). */
export interface GeminiModelsApi {
  generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse>;
}

export interface GeminiConfig {
  apiKey: string;
  /** For reading text off a photo (tier "fast"). */
  fastModel: string;
  /** For naming food in a photo and writing ideas (tier "smart"). */
  smartModel: string;
  onUsage?: (usage: AiUsage) => void;
}

/**
 * Google Gemini via the official @google/genai SDK, with JSON structured output. It returns the same
 * unchecked JSON as the Claude client: callers validate it with zod and apply the same banned-wording check.
 */
export function createGeminiClient(
  config: GeminiConfig,
  models: GeminiModelsApi = new GoogleGenAI({ apiKey: config.apiKey, httpOptions: { timeout: 60_000 } }).models,
): AiClient {
  return {
    model: config.fastModel === config.smartModel ? config.fastModel : `${config.fastModel} / ${config.smartModel}`,
    async generate({ system, prompt, schema, maxTokens, images = [], tier = 'fast' }) {
      const model = tier === 'smart' ? config.smartModel : config.fastModel;
      const response = await models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              ...images.map((image) => ({ inlineData: { mimeType: image.mediaType, data: image.base64 } })),
              { text: prompt },
            ],
          },
        ],
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          temperature: 0,
          // Gemini 2.5+ counts its thinking tokens against this limit, so leave room beyond the answer.
          maxOutputTokens: Math.max(maxTokens * 4, 2048),
        },
      });
      const usage = response.usageMetadata;
      config.onUsage?.({
        model,
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      });
      const finish = response.candidates?.[0]?.finishReason;
      if (finish && String(finish) !== 'STOP') throw new Error(`AI stopped early: ${finish}`);
      const text = response.text;
      if (!text) throw new Error('AI returned no text');
      return JSON.parse(text);
    },
  };
}
