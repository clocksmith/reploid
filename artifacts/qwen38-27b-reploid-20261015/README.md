# Qwen3.8-27B application integration, 2026-10-15

This is a source candidate, not an installed inference qualification or a deployment.

## Identity and delivery

- Standard Doppler package: 0.6.30, pinned by `self/config/doppler-package.json`.
- Model: `qwen3-8-27b-text-f16-af32`, upstream Qwen/Qwen3.8-27B revision `1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0`.
- Manifest SHA-256: `f4ad42e6706edb4c8b1b236230bff713fc0fbe70b22a3996ddc0a4cb7d777735`.
- F16 weights, F32 activations. This does not implement packed Q8 or establish a llama.cpp performance comparison.
- Verified 802 weight shards, tokenizer, upstream LICENSE and conversion notice were published before the manifest. See [publication receipt](publish/complete.json) and [HTTP range/CORS check](publish/http.json).
- [Upstream license at the pinned revision](https://huggingface.co/Qwen/Qwen3.8-27B/blob/1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0/LICENSE).

## Implemented behavior

The shared selector distinguishes whole-model requests from distributed layers. No prepared route means unavailable; cached whole-model files do not imply a distributed route. The configured 128-token answer cap is visible before sending.

Native `--execution-mode whole-model` uses Reploid's resident provider and verifies the catalog manifest before GPU opening. It supplies the exact manifest text and identity rather than using a URL as the runtime model ID. `--execution-mode partition --partition-index 1` explicitly offers only the output stage. Browser eligibility is restricted to the smaller input stage. Planned geometry is layer 0 plus embeddings, followed by layers 1–63 and the head; geometry and budgets are configuration, not physical qualification.

Native file supply reuses approved local pieces without duplicating the entire weight set in its bounded cache. Every served piece is verified again. Downloads remain opt-in.

## Retained observations

- [Desktop and phone selector checks](selector.json): both mode labels, unavailable state, visible answer cap, no horizontal overflow or page exceptions. These are UI checks, not inference proof.
- [Browser compatibility result](browser-compatibility.json): the pinned 0.8B model loaded, streamed and closed through Doppler 0.6.30 using verified local files served over loopback. It answered the arithmetic prompt incorrectly with `2`.
- [Previous package control](browser-compatibility-previous.json): 0.6.27-unicode.1 produced the same incorrect text for the same weights, template and generation settings. Neither result is a quality pass. Direct Hugging Face smoke attempts exceeded their 120-second check limit during loading.
- The 27B AMD application-provider attempt stopped making progress after loading layer 29. The process remained in uninterruptible `drm_suballoc_new` after SIGTERM and SIGKILL. [Process state](whole-proof/process.txt), [kernel excerpts](whole-proof/driver.txt), [loading log](whole-proof/runtime.log), and [memory guard samples](whole-proof/memory.jsonl) are retained. No answer was generated. The 600-second guard could request termination but could not force kernel ownership settlement.
- Standalone 27B success is separate evidence in Doppler's `artifacts/qwen38-27b-webgpu-20261015/`; it does not establish this application path.

## Remaining acceptance

Recover amd-host with the owner's approval before any further GPU run. Recheck the native whole-model path with the corrected explicit manifest source, then real browser requests. Qualify the physical two-machine route separately, including its assigned pieces, memory, output, cancellation and cleanup. Deploy only after the application checks pass. No such deployment is claimed here.
