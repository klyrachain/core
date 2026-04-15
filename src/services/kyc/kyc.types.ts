/**
 * Shared types for the KYC provider abstraction layer.
 * No provider names are ever returned to the browser — only normalised status strings.
 */

export type KycProvider = "didit" | "persona";

/** Normalised status stored on PeerRampAppUser and returned to the frontend. */
export type KycStatus =
  | "approved"
  | "declined"
  | "in_review"
  | "pending"
  | "resubmitting"
  | null;

/** Returned from initKycSession to the route handler, then on to the frontend. */
export type KycInitResult = {
  /** Which integration to render (Didit iframe vs Persona CDN). Not a secret; required by the client. */
  provider: KycProvider;
  /** Opaque ID — never reveals provider name. */
  externalId: string;
  /** DIDIT only: the iframe/redirect URL. */
  verificationUrl?: string;
  /** Persona only: the pre-created inquiry ID (goes to CDN client). */
  inquiryId?: string;
  /** Persona only: resume token for an in-progress inquiry. */
  sessionToken?: string | null;
  /** Persona only: environment ID for CDN client (not secret). */
  environmentId?: string;
};

export type KycStatusResult = {
  kycStatus: KycStatus;
  kycVerifiedAt: Date | null;
};

/** Raw DIDIT webhook payload (status.updated event). */
export type DiditWebhookPayload = {
  session_id: string;
  status: string;
  webhook_type: string;
  vendor_data?: string;
  workflow_id?: string;
  decision?: unknown;
  resubmit_info?: unknown;
  [key: string]: unknown;
};

/** Raw Persona webhook payload (inquiry.* events). */
export type PersonaWebhookPayload = {
  data?: {
    type?: string;
    id?: string;
    attributes?: {
      status?: string;
      "reference-id"?: string;
      [key: string]: unknown;
    };
  };
  [key: string]: unknown;
};
