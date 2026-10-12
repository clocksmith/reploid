# Run a native Reploid participant

This is the same application host and participant protocol as the browser.
The generated delivery copies canonical source and catalog bytes; it does not
maintain another runtime. Linux/Vulkan native computation has physical evidence
under [native files](https://github.com/clocksmith/reploid/tree/main/artifacts/native-files-20261012). Signed opening and
whole-model numerical and document-quality acceptance remain separate gates.

Use Node 22.13 or newer. From the checkout, run `npm ci`, then
`npm run start:native -- --help`. WebRTC and WebGPU dependencies are declared
optional at the application root so browser development can omit them.

To create an installable native delivery without a source checkout on its host:

```sh
npm run package:native
```

The output reports an archive path and its SHA-256. Copy that archive to the
native host, verify its reported hash, extract it, and enter the `reploid`
directory. Its `native-delivery.json` binds the source files, catalog, lockfile
and unchanged accepted Doppler archive. No model weights are included.

```sh
npm ci --no-audit --no-fund
npm start -- --help
mkdir -p weights
npm start -- --connect-only \
  --model qwen-3-5-0-8b-q4k-ehaf16 \
  --model-directory ./weights \
  --identity-file ./state/identity.json \
  --rtc-module @roamhq/wrtc --ws-module ws
```

`--connect-only` authenticates and discovers participants without starting the
GPU or offering files. The model directory may start empty. Use `--contribute`
and `--gpu-module webgpu` to authorize compute: the existing coordinator chooses
the assigned partition and obtains its missing verified pieces from authorized
suppliers. Use `--share-files` to authorize file supply independently, or combine
it with `--contribute`. Neither mode grants disclosure of requester messages.

The native delivery requires `@roamhq/wrtc` and `ws`; `webgpu` is optional for
connections and file supply. For a host with no compute, installation may use
`npm ci --omit=optional`. Compute must have an installed compatible WebGPU
provider, Vulkan driver and adapter. Optional dependency installation failure
does not qualify compute; selecting an unavailable provider fails explicitly.

Public discovery uses the application's existing bootstrap configuration.
Private deployments can supply `--signaling-url`, `--room`, `--room-token`
and `--origin` explicitly. Protect the identity file and its parent directory;
they contain the contributor's signing key. SIGINT or SIGTERM settles work,
closes authenticated channels and releases owned resources before natural exit.

The retained development runs used absolute temporary module paths; ordinary
installation uses the named packages above. Installing or connecting alone
does not establish useful distributed answers, numerical accuracy or release
qualification. No package publication or deployment occurs during packaging.
