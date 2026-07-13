import { config } from '../config.js';
import type { EmbeddingProvider } from './types.js';

interface OllamaEmbeddingResponse {
  embedding: number[];
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  async generate(text: string): Promise<number[]> {
    const url = `${config.ollamaUrl}/api/embeddings`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.embeddingTimeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.ollamaModel, prompt: text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as OllamaEmbeddingResponse;
      return data.embedding;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`Ollama embedding timed out after ${config.embeddingTimeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
