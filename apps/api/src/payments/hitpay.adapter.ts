import { UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CreateGatewayPaymentInput,
  CreateGatewayPaymentResult,
  PaymentGatewayAdapter,
  WebhookEvent,
} from "./gateway.interface";

/**
 * HitPay (SG-first, covers PayNow QR, cards, wallets; also MY methods).
 * Activated only when HITPAY_API_KEY and HITPAY_SALT are set.
 * Docs: https://docs.hitpayapp.com — payment-requests API + HMAC webhooks.
 */
export class HitPayAdapter implements PaymentGatewayAdapter {
  readonly provider = "HITPAY";

  constructor(
    private readonly apiKey: string,
    private readonly salt: string,
    private readonly sandbox: boolean,
    private readonly webhookUrl: string,
  ) {}

  private get baseUrl(): string {
    return this.sandbox
      ? "https://api.sandbox.hit-pay.com/v1"
      : "https://api.hit-pay.com/v1";
  }

  async createPayment(
    input: CreateGatewayPaymentInput,
  ): Promise<CreateGatewayPaymentResult> {
    const res = await fetch(`${this.baseUrl}/payment-requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BUSINESS-API-KEY": this.apiKey,
      },
      body: JSON.stringify({
        amount: (input.amountCents / 100).toFixed(2),
        currency: input.currency,
        reference_number: input.referenceId,
        purpose: input.description,
        generate_qr: true,
        webhook: this.webhookUrl,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HitPay createPayment failed (${res.status}): ${text}`);
    }
    const data = (await res.json()) as {
      id: string;
      qr_code_data?: { qr_code?: string };
      url?: string;
      expiry_date?: string;
    };
    return {
      providerRef: data.id,
      qrData: data.qr_code_data?.qr_code,
      checkoutUrl: data.url,
      expiresAt: data.expiry_date ? new Date(data.expiry_date) : undefined,
    };
  }

  /** HitPay signs webhooks with HMAC-SHA256 over sorted key=value pairs. */
  async verifyWebhook(body: Record<string, unknown>): Promise<WebhookEvent> {
    const { hmac, ...fields } = body as Record<string, string>;
    if (!hmac) throw new UnauthorizedException("Missing hmac");
    const payload = Object.keys(fields)
      .sort()
      .map((k) => `${k}${fields[k]}`)
      .join("");
    const expected = createHmac("sha256", this.salt).update(payload).digest("hex");
    const a = Buffer.from(String(hmac));
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("Bad webhook signature");
    }
    return {
      providerRef: String(fields.payment_request_id ?? fields.payment_id ?? ""),
      status: fields.status === "completed" ? "SUCCEEDED" : "FAILED",
      failReason: fields.status === "completed" ? undefined : String(fields.status),
    };
  }
}
