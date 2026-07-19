import { randomUUID } from "node:crypto";
import {
  EInvoiceProvider,
  StatusResult,
  SubmitResult,
} from "./provider.interface";

/**
 * Dev/demo provider mirroring MyInvois behavior: submission is accepted
 * immediately, validation "completes" on the next status poll.
 */
export class MockEInvoiceProvider implements EInvoiceProvider {
  readonly name = "MOCK";

  async submit(_document: object, internalId: string): Promise<SubmitResult> {
    void internalId;
    return { providerUuid: `mockinv_${randomUUID()}`, status: "SUBMITTED" };
  }

  async getStatus(providerUuid: string): Promise<StatusResult> {
    const shortId = providerUuid.slice(-12).toUpperCase();
    return {
      status: "VALID",
      longId: `MOCK${shortId}`,
      qrUrl: `https://myinvois.example/validate/${providerUuid}`,
    };
  }
}
