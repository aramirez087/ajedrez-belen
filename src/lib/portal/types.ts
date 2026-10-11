export interface Actor {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  mode: "demo" | "workos";
}
export interface Athlete {
  id: string;
  name: string;
  category: string;
  feeMinor: number;
  discountMinor: number;
  discountReason: string | null;
  active: boolean;
  startPeriod: string;
}
export interface Charge {
  id: string;
  athleteId: string;
  athleteName: string;
  period: string;
  dueDate: string;
  baseMinor: number;
  discountMinor: number;
  discountReason: string | null;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
}
export type PaymentStatus =
  | "pending"
  | "needs_info"
  | "rejected"
  | "verified"
  | "void";
export interface Payment {
  id: string;
  designatedAdultId: string;
  submitterId: string;
  payerName: string;
  amountMinor: number;
  transferDate: string;
  bankReference: string;
  status: PaymentStatus;
  reviewNote: string | null;
  submittedAt: string;
  revision: number;
  verifiedAmountMinor: number | null;
  unallocatedMinor: number;
  receiptId: string | null;
  receiptNumber: string | null;
}
export interface PaymentFile {
  id: string;
  paymentId: string;
  key: string;
  type: string;
  size: number;
  sha256: string;
  revision: number;
  createdAt: string;
}
export interface RequestedAllocation {
  chargeId: string;
  amountMinor: number;
}
export interface ReceiptSnapshot {
  version: 1;
  receiptNumber: string;
  associationName: string;
  payerName: string;
  paymentDate: string;
  issuedAt: string;
  currency: "CRC";
  amountMinor: number;
  bankReference: string;
  bankName: string;
  receivingAccount: string;
  lines: Array<{
    athleteId: string;
    athleteName: string;
    chargeId: string;
    period: string;
    amountMinor: number;
  }>;
  unallocatedMinor: number;
  designatedAdult: { id: string; name: string; email: string };
  demo: boolean;
}
export interface Receipt {
  id: string;
  paymentId: string;
  number: string;
  status: "issued" | "void";
  snapshot: ReceiptSnapshot;
  voidReason: string | null;
  voidedAt: string | null;
  emailStatus: string | null;
  canPrepareEmail: boolean;
}
export interface ParentDashboard {
  athletes: Athlete[];
  charges: Charge[];
  payments: Payment[];
  receipts: Receipt[];
  balanceMinor: number;
  pendingMinor: number;
  creditMinor: number;
}
export interface Family {
  adultId: string;
  adultName: string;
  email: string;
  active: boolean;
  athletes: Array<Athlete & { receiptOptIn: boolean }>;
}
export interface AdminDashboard {
  payments: Payment[];
  charges: Charge[];
  athletes: Athlete[];
  receipts: Receipt[];
  pendingCount: number;
  balanceMinor: number;
  verifiedMinor: number;
  creditMinor: number;
  emailPendingCount: number;
}
export interface MonthlyPreview {
  period: string;
  dueDate: string;
  athletes: Array<Athlete & { alreadyPublished: boolean; totalMinor: number }>;
  newCount: number;
  totalMinor: number;
}
export interface PaymentDetail {
  payment: Payment;
  files: PaymentFile[];
  requestedAllocations: Array<
    RequestedAllocation & {
      athleteId: string;
      athleteName: string;
      period: string;
      balanceMinor: number;
    }
  >;
  revisions: Array<{
    id: string;
    payerName: string;
    amountMinor: number;
    transferDate: string;
    bankReference: string;
    note: string | null;
    createdAt: string;
  }>;
  audit: Array<{ action: string; detail: string; createdAt: string }>;
  receipt: Receipt | null;
}
export interface SlipMetadata {
  key: string;
  type: string;
  size: number;
  sha256: string;
}
export interface SubmitPaymentInput {
  payerName: string;
  amountMinor: number;
  transferDate: string;
  bankReference: string;
  allocations: RequestedAllocation[];
  file: SlipMetadata;
  designatedAdultId?: string;
  auditReason?: string;
  shareEvidence?: boolean;
  note?: string;
}
export interface VerifyPaymentInput {
  action: "verify";
  bankChecked: boolean;
  associationName?: string;
  bankName: string;
  receivingAccount: string;
  bankReference: string;
  amountMinor: number;
  paymentDate: string;
  currency: "CRC";
  allocations: RequestedAllocation[];
  note?: string;
}
/** The exact submission and state shown when the administrator loaded the form. */
export interface PaymentReviewSnapshot {
  expectedRevision: number;
  expectedStatus: PaymentStatus;
  expectedReviewNote: string | null;
}
export type ReviewPaymentInput = PaymentReviewSnapshot & (
  | VerifyPaymentInput
  | { action: "needs_info" | "reject" | "void"; reason: string }
);
export interface ChargeAdjustmentInput {
  operationId: string;
  chargeId: string;
  amountMinor: number;
  reason: string;
}
export interface ApplyPaymentCreditInput {
  operationId: string;
  paymentId: string;
  allocations: RequestedAllocation[];
  reason: string;
}
export interface AthleteInput {
  name: string;
  category: string;
  feeMinor: number;
  discountMinor: number;
  discountReason?: string;
  active?: boolean;
  startPeriod: string;
}
export class PortalError extends Error {
  readonly code: string;
  constructor(
    public readonly status: number,
    message: string,
    code = "invalid_request",
  ) {
    super(message);
    this.name = "PortalError";
    this.code = code;
  }
}
export { PortalError as DomainError };
