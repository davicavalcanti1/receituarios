export const PRESCRIPTION_TEMPLATE_TYPES = [
  "anestesia_dr_felix",
  "longactil",
  "procedimentos_dia",
  "custom",
] as const;

export const PRESCRIPTION_JOB_STATUSES = [
  "draft",
  "imported",
  "review_pending",
  "signature_pending",
  "partially_signed",
  "completed",
  "cancelled",
] as const;

export const PRESCRIPTION_ITEM_STATUSES = [
  "draft",
  "validated",
  "review_pending",
  "signature_pending",
  "signed",
  "rejected",
  "cancelled",
] as const;

export type PrescriptionTemplateType = (typeof PRESCRIPTION_TEMPLATE_TYPES)[number];
export type PrescriptionJobStatus = (typeof PRESCRIPTION_JOB_STATUSES)[number];
export type PrescriptionItemStatus = (typeof PRESCRIPTION_ITEM_STATUSES)[number];

export interface PrescriptionJobSummary {
  id: string;
  title: string;
  jobType: PrescriptionTemplateType;
  status: PrescriptionJobStatus;
  totalItems: number;
  signedItems: number;
  updatedAt: string | null;
}

export interface PrescriptionOverview {
  schemaReady: boolean;
  templatesCount: number;
  activeJobsCount: number;
  pendingSignatureCount: number;
  signedItemsCount: number;
  recentJobs: PrescriptionJobSummary[];
}
