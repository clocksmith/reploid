# Anonymous Shared Inference

`POST /api/chat` is the shared boot-shell gateway for anonymous browser inference. It does not grant access to provider-specific proxy routes, VFS backup, Agent Bridge, Poolday, Zero, or X.

The endpoint is disabled unless deployment configuration explicitly enables it and defines every public provider/model pair. This avoids turning newly added provider credentials into public spend by default.

## Required Configuration

```bash
REPLOID_PUBLIC_INFERENCE_ENABLED=true
REPLOID_PUBLIC_INFERENCE_MODEL_POLICIES='{
  "gemini": {
    "gemini-3.5-flash": {
      "maxInputTokens": 4096,
      "maxOutputTokens": 512,
      "maxEstimatedCostUsd": 0.01,
      "inputUsdPerMillionTokens": 0.10,
      "outputUsdPerMillionTokens": 0.40,
      "maxDailyCostUsd": 0.10
    }
  }
}'
```

The model policy is an allowlist. A request for any provider or model absent from this object is rejected before the server uses a provider credential. Keep unit prices current with the provider's billing configuration and set `maxEstimatedCostUsd` below the intended maximum for one request.

## Per-Client Limits

```bash
REPLOID_PUBLIC_INFERENCE_MAX_INPUT_CHARS=16000
REPLOID_PUBLIC_INFERENCE_REQUESTS_PER_MINUTE=5
REPLOID_PUBLIC_INFERENCE_REQUESTS_PER_DAY=40
REPLOID_PUBLIC_INFERENCE_MAX_CONCURRENT_REQUESTS=1
```

The gateway keys anonymous quotas to the server-observed client address. It does not use `X-Reploid-Client-Id` for admission because callers can forge that header. Deployments behind a known reverse proxy must set the exact trusted hop count:

```bash
REPLOID_TRUST_PROXY_HOPS=1
```

The gateway reserves the maximum configured cost at admission, based on estimated input tokens and the capped output token count. Reservations are not refunded on provider failure. This deliberately favors a hard public-spend bound over allowing retries to evade the daily cap.

## Enforcement

- Direct provider proxies require protected server access.
- The anonymous route accepts only plain text `system`, `user`, and `assistant` messages.
- Each provider request receives the admitted output-token cap.
- Prompt bodies are not logged by the anonymous admission path.

*Last updated: July 2026*
