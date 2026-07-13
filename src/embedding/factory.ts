import { config } from '../config.js';
import type { EmbeddingProvider } from './types.js';

export async function createEmbeddingProvider(): Promise<EmbeddingProvider> {
  const dimensions = config.embeddingDimensions;

  switch (config.embeddingProvider) {
    case 'ollama': {
      const { OllamaEmbeddingProvider } = await import('./ollama-provider.js');
      return new OllamaEmbeddingProvider(dimensions);
    }
    case 'openai': {
      if (!config.openaiApiKey) {
        throw new Error('OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai');
      }
      const { OpenAIEmbeddingProvider } = await import('./openai-provider.js');
      return new OpenAIEmbeddingProvider(config.openaiApiKey, dimensions);
    }
    default:
      throw new Error(
        `Unknown embedding provider: ${config.embeddingProvider}. Use 'ollama' or 'openai'.`
      );
  }
}
