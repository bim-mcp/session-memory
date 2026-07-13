export interface EmbeddingProvider {
  generate(text: string): Promise<number[]>;
  readonly dimensions: number;
}
