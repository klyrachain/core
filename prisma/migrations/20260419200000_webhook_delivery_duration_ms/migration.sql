-- Optional per-delivery latency for merchant webhook dashboards.
ALTER TABLE "WebhookDeliveryLog" ADD COLUMN "durationMs" INTEGER;
