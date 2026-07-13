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
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.ollamaModel, prompt: text }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OllamaEmbeddingResponse;
    return data.embedding;
  }
}
