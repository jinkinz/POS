import { createHash } from "node:crypto";
import {
  EInvoiceProvider,
  StatusResult,
  SubmitResult,
} from "./provider.interface";

/**
 * LHDN MyInvois API adapter. Activates when MYINVOIS_CLIENT_ID/SECRET are
 * set (sandbox by default). NOTE: document version 1.1 requires an X.509
 * digital signature; this adapter submits unsigned v1.0-shaped documents —
 * wire your signing cert into buildPayload before production use.
 */
export class MyInvoisProvider implements EInvoiceProvider {
  readonly name = "MYINVOIS";
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly sandbox: boolean,
  ) {}

  private get baseUrl(): string {
    return this.sandbox
      ? "https://preprod-api.myinvois.hasil.gov.my"
      : "https://api.myinvois.hasil.gov.my";
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }
    const res = await fetch(`${this.baseUrl}/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "client_credentials",
        scope: "InvoicingAPI",
      }),
    });
    if (!res.ok) {
      throw new Error(`MyInvois auth failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return data.access_token;
  }

  async submit(document: object, internalId: string): Promise<SubmitResult> {
    const token = await this.accessToken();
    const json = JSON.stringify(document);
    const res = await fetch(`${this.baseUrl}/api/v1.0/documentsubmissions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        documents: [
          {
            format: "JSON",
            document: Buffer.from(json).toString("base64"),
            documentHash: createHash("sha256").update(json).digest("hex"),
            codeNumber: internalId,
          },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`MyInvois submit failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as {
      acceptedDocuments?: { uuid: string }[];
      rejectedDocuments?: { invoiceCodeNumber: string; error?: { message?: string } }[];
    };
    const accepted = data.acceptedDocuments?.[0];
    if (!accepted) {
      const reason =
        data.rejectedDocuments?.[0]?.error?.message ?? "document rejected";
      throw new Error(`MyInvois rejected document: ${reason}`);
    }
    return { providerUuid: accepted.uuid, status: "SUBMITTED" };
  }

  async getStatus(providerUuid: string): Promise<StatusResult> {
    const token = await this.accessToken();
    const res = await fetch(
      `${this.baseUrl}/api/v1.0/documents/${providerUuid}/details`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(`MyInvois status failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as {
      status: string;
      longId?: string;
      validationResults?: { status: string };
    };
    const status =
      data.status === "Valid"
        ? "VALID"
        : data.status === "Invalid"
          ? "INVALID"
          : "SUBMITTED";
    return {
      status,
      longId: data.longId,
      qrUrl: data.longId
        ? `${this.sandbox ? "https://preprod.myinvois.hasil.gov.my" : "https://myinvois.hasil.gov.my"}/${providerUuid}/share/${data.longId}`
        : undefined,
      error: status === "INVALID" ? "validation failed" : undefined,
    };
  }
}
