-- Merchant webhook destinations: dashboard label + protocol version for outbound payloads.
ALTER TABLE "WebhookEndpoint" ADD COLUMN "displayName" TEXT NOT NULL DEFAULT 'Webhook';
ALTER TABLE "WebhookEndpoint" ADD COLUMN "protocolVersion" TEXT NOT NULL DEFAULT 'v1';
