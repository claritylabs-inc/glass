/**
 * PrismClient — thin HTTP client for Convex MCP routes.
 */
export class PrismClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    // Remove trailing slash
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, value);
        }
      }
    }
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  // ── Policies ──

  async listPolicies(filters?: { carrier?: string; year?: string; type?: string }) {
    return this.get("/mcp/policies/list", filters);
  }

  async getPolicy(id: string) {
    return this.get("/mcp/policies/get", { id });
  }

  async searchPolicies(q: string) {
    return this.get("/mcp/policies/search", { q });
  }

  async getPolicyStats() {
    return this.get("/mcp/policies/stats");
  }

  // ── Quotes ──

  async listQuotes(filters?: { carrier?: string; year?: string }) {
    return this.get("/mcp/quotes/list", filters);
  }

  async getQuote(id: string) {
    return this.get("/mcp/quotes/get", { id });
  }

  // ── Applications ──

  async listApplications() {
    return this.get("/mcp/applications/list");
  }

  async getApplication(id: string) {
    return this.get("/mcp/applications/get", { id });
  }

  async cancelApplication(id: string) {
    return this.post("/mcp/applications/cancel", { id });
  }

  // ── Threads ──

  async listThreads() {
    return this.get("/mcp/threads/list");
  }

  async getThreadMessages(threadId: string) {
    return this.get("/mcp/threads/messages", { threadId });
  }

  // ── Business Context ──

  async listBusinessContext() {
    return this.get("/mcp/context/list");
  }

  async upsertBusinessContext(category: string, key: string, value: string) {
    return this.post("/mcp/context/upsert", { category, key, value });
  }

  // ── Org ──

  async getOrgInfo() {
    return this.get("/mcp/org/info");
  }

  // ── Ask Prism ──

  async ask(message: string, threadId?: string) {
    return this.post<{ threadId: string; response: string }>("/mcp/ask", {
      message,
      threadId,
    });
  }
}
