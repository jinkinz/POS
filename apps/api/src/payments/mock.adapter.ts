import { UnauthorizedException } from "@nestjs/common";
import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  CreateGatewayPaymentInput,
  CreateGatewayPaymentResult,
  PaymentGatewayAdapter,
  WebhookEvent,
} from "./gateway.interface";

/**
 * Development/demo gateway. "Scanning" is simulated by posting the webhook:
 *   POST /api/webhooks/mock { "ref": "<providerRef>", "status": "completed",
 *                             "secret": "<MOCK_GATEWAY_SECRET>" }
 * Disabled in production unless MOCK_GATEWAY_ENABLED=true is set explicitly.
 */
export class MockGatewayAdapter implements PaymentGatewayAdapter {
  readonly provider = "MOCK";

  private get secret(): string {
    return process.env.MOCK_GATEWAY_SECRET ?? "mock-secret";
  }

  async createPayment(
    input: CreateGatewayPaymentInput,
  ): Promise<CreateGatewayPaymentResult> {
    const providerRef = `mock_${randomUUID()}`;
    return {
      providerRef,
      // Any QR scanner shows this string; a real gateway returns EMVCo data.
      qrData: `MOCKPAY|${providerRef}|${input.currency}|${input.amountCents}`,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    };
  }

  async verifyWebhook(body: Record<string, unknown>): Promise<WebhookEvent> {
    const supplied = String(body.secret ?? "");
    const expected = this.secret;
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("Bad webhook secret");
    }
    const ref = String(body.ref ?? "");
    if (!ref) throw new UnauthorizedException("Missing ref");
    return {
      providerRef: ref,
      status: body.status === "completed" ? "SUCCEEDED" : "FAILED",
      failReason: body.status === "completed" ? undefined : String(body.status),
    };
  }
}
