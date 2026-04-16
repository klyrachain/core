#!/usr/bin/env bash
# Quick checks against Core POST /api/v1/quotes (pricing engine + Fonbnk paths).
#
# ONRAMP math (inputSide=from): crypto_out ≈ fiat_in / exchangeRate
#   Example: 400 GHS / 12.59 GHS per USDC ≈ 31.78 USDC (sellingPrice is the margin-inclusive rate).
#
# Usage:
#   export CORE_URL=http://127.0.0.1:4003
#   export CORE_API_KEY=your_platform_key
#   ./scripts/quote-smoke.sh
set -euo pipefail
BASE="${CORE_URL:-http://127.0.0.1:4003}"
KEY="${CORE_API_KEY:-}"
if [[ -z "$KEY" ]]; then
  echo "Set CORE_API_KEY (and optionally CORE_URL)." >&2
  exit 1
fi

hdr=(-H "Content-Type: application/json" -H "x-api-key: ${KEY}")

echo "=== 1) ONRAMP: pay fiat, receive crypto (inputSide=from) ==="
curl -sS "${BASE}/api/v1/quotes" "${hdr[@]}" -d '{
  "action":"ONRAMP",
  "inputAmount":"400",
  "inputCurrency":"GHS",
  "outputCurrency":"USDC",
  "chain":"BASE",
  "inputSide":"from"
}' | jq .

echo "=== 2) ONRAMP: target crypto amount; inputCurrency=crypto, outputCurrency=fiat (inputSide=to) ==="
curl -sS "${BASE}/api/v1/quotes" "${hdr[@]}" -d '{
  "action":"ONRAMP",
  "inputAmount":"35",
  "inputCurrency":"USDC",
  "outputCurrency":"GHS",
  "chain":"BASE",
  "inputSide":"to"
}' | jq .

echo "=== 3) OFFRAMP: sell crypto, receive fiat (inputSide=from) ==="
curl -sS "${BASE}/api/v1/quotes" "${hdr[@]}" -d '{
  "action":"OFFRAMP",
  "inputAmount":"35",
  "inputCurrency":"USDC",
  "outputCurrency":"GHS",
  "chain":"BASE",
  "inputSide":"from"
}' | jq .

echo "=== 4) OFFRAMP: want 400 GHS out; compute crypto to sell (inputSide=to) ==="
curl -sS "${BASE}/api/v1/quotes" "${hdr[@]}" -d '{
  "action":"OFFRAMP",
  "inputAmount":"400",
  "inputCurrency":"GHS",
  "outputCurrency":"USDC",
  "chain":"BASE",
  "inputSide":"to"
}' | jq .

echo "=== 5) Checkout batch (server-side rows; slim client payload) ==="
curl -sS "${BASE}/api/v1/quotes/checkout" "${hdr[@]}" -d '{
  "inputAmount":"400",
  "inputCurrency":"GHS"
}' | jq .

echo "Done."
