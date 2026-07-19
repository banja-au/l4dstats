export interface DiscoveredDemo {
  sourceId: string;
  sourceItemKey: string;
  publishedAt: string;
  downloadUrl: string;
  filename: string;
  declaredBytes: number | null;
  gameHint: string | null;
  metadata: Record<string, unknown>;
}

export interface PendingDemo extends DiscoveredDemo {
  attempts: number;
}

export interface SourceAdapter {
  id: string;
  discover(signal?: AbortSignal): Promise<DiscoveredDemo[]>;
}
