/** One implementation per tax-authority rail (MyInvois, InvoiceNow, ...). */
export interface SubmitResult {
  providerUuid: string;
  status: "SUBMITTED" | "VALID";
  longId?: string;
  qrUrl?: string;
}

export interface StatusResult {
  status: "SUBMITTED" | "VALID" | "INVALID";
  longId?: string;
  qrUrl?: string;
  error?: string;
}

export interface EInvoiceProvider {
  readonly name: string;

  /** Submit one document (already built as provider-appropriate JSON). */
  submit(document: object, internalId: string): Promise<SubmitResult>;

  /** Poll validation status (authorities validate asynchronously). */
  getStatus(providerUuid: string): Promise<StatusResult>;
}
