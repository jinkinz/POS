/**
 * One implementation per gateway (HitPay, Fiuu, ...). Adapters are stateless;
 * all persistence lives in PaymentsService.
 */
export interface CreateGatewayPaymentInput {
  amountCents: number;
  currency: "MYR" | "SGD";
  /** Our GatewayPayment id — sent to the gateway as the merchant reference. */
  referenceId: string;
  description: string;
}

export interface CreateGatewayPaymentResult {
  providerRef: string;
  /** Payload the POS renders as a QR code (DuitNow/PayNow string or URL). */
  qrData?: string;
  checkoutUrl?: string;
  expiresAt?: Date;
}

export interface WebhookEvent {
  providerRef: string;
  status: "SUCCEEDED" | "FAILED";
  failReason?: string;
}

export interface PaymentGatewayAdapter {
  readonly provider: string;

  createPayment(input: CreateGatewayPaymentInput): Promise<CreateGatewayPaymentResult>;

  /**
   * Verify an incoming webhook (signature/secret) and normalize it.
   * MUST throw on any verification failure.
   */
  verifyWebhook(
    body: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<WebhookEvent>;
}
