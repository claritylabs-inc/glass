import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { OperatorConfig, requireConfig } from "./config.js";
import { signOperatorRequest } from "./signing.js";

const api = anyApi;

export class OperatorClient {
  private readonly convex: ConvexHttpClient;
  private readonly config: Required<Pick<OperatorConfig, "convexUrl" | "token">> & OperatorConfig;

  constructor(config: OperatorConfig) {
    this.config = requireConfig(config);
    this.convex = new ConvexHttpClient(this.config.convexUrl);
  }

  async checkAuth() {
    const body = {};
    return await this.convex.action(api.operatorProvisioning.checkAuth, {
      operatorAuth: signOperatorRequest({
        token: this.config.token,
        tokenId: this.config.tokenId,
        body,
      }),
    });
  }

  async provisionBroker(body: Record<string, unknown>) {
    const normalizedBody = {
      ...body,
      clients: Array.isArray(body.clients) ? body.clients : [],
      markOnboardingComplete: typeof body.markOnboardingComplete === "boolean"
        ? body.markOnboardingComplete
        : true,
    };
    return await this.convex.action(api.operatorProvisioning.provisionBroker, {
      operatorAuth: signOperatorRequest({
        token: this.config.token,
        tokenId: this.config.tokenId,
        body: normalizedBody,
      }),
      ...normalizedBody,
    });
  }
}
