/**
 * GlassClient — thin HTTP client for Convex MCP routes.
 */
export class GlassClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    // Remove trailing slash
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
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

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
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

  async getPolicyPdf(id: string) {
    return this.get("/mcp/policies/file", { id });
  }

  async searchPolicies(q: string) {
    return this.get("/mcp/policies/search", { q });
  }

  async getPolicyStats() {
    return this.get("/mcp/policies/stats");
  }

  async listPolicyCertificates(policyId: string) {
    return this.get("/mcp/policies/certificates/list", { policyId });
  }

  async generatePolicyCertificate(input: {
    policyId: string;
    holderName: string;
    holderEmail?: string;
    holderPhone?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    requestText?: string;
    requestedEndorsements?: string[];
    explicitReissue?: boolean;
  }) {
    return this.post("/mcp/policies/certificates/generate", input);
  }

  async listCertificateHolders(query?: string) {
    return this.get("/mcp/certificates/holders/list", { query });
  }

  async listPolicyVersions(policyId?: string) {
    return this.get("/mcp/policies/versions/list", { policyId });
  }

  async listCertificateVersions(filters?: {
    policyId?: string;
    certificateId?: string;
    holderId?: string;
    certificateHolderId?: string;
  }) {
    return this.get("/mcp/policies/certificates/versions/list", filters);
  }

  async listCertificateReviewJobs(filters?: { policyId?: string; status?: string }) {
    return this.get("/mcp/certificates/review-jobs/list", filters);
  }

  // ── Threads ──

  async listThreads() {
    return this.get("/mcp/threads/list");
  }

  async getThreadMessages(threadId: string) {
    return this.get("/mcp/threads/messages", { threadId });
  }

  // ── Org ──

  async getOrgInfo() {
    return this.get("/mcp/org/info");
  }

  // ── Ask Glass ──

  async ask(message: string, threadId?: string) {
    return this.post<{ threadId: string; response: string }>("/mcp/ask", {
      message,
      threadId,
    });
  }

  // ── Email Drafts ──

  async listEmailDrafts(threadId?: string) {
    return this.get("/mcp/email/drafts/list", { threadId });
  }

  async upsertEmailDraft(input: {
    draftId?: string;
    threadId?: string;
    to: string;
    subject: string;
    body: string;
    cc?: string[];
    bcc?: string[];
    originalPolicyIds?: string[];
  }) {
    return this.post("/mcp/email/drafts/upsert", input);
  }

  async sendEmailDraft(draftId: string) {
    return this.post("/mcp/email/drafts/send", { draftId });
  }

  async cancelEmailDraft(draftId: string) {
    return this.post("/mcp/email/drafts/cancel", { draftId });
  }
}
