import OpenAI from 'openai';
import { config } from '../config.js';
import type { EmbeddingProvider } from './types.js';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private client: OpenAI;

  constructor(apiKey: string, dimensions: number) {
    this.dimensions = dimensions;
    this.client = new OpenAI({ apiKey });
  }

  async generate(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: config.embeddingModel,
      input: text,
    });
    return response.data[0].embedding;
  }
}
