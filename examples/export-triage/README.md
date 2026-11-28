# Train an adapter across two computers

This workout compares a two-browser LoRA update on Qwen3.5-0.8B with a single-browser reference. Each computer uses its own GPU, signs its own peer identity, selects its own sample and grants permission to share its gradient for one round. Only the coordinator applies AdamW. The workout stores candidate adapters locally for evaluation.

## Reproduce the workout

1. Use a clean checkout on both computers, run `npm ci` and `npm run build`, and provision the same 18 model shards and tokenizer on each. The training model route and optimizer configuration live in [the training policy](../../apps/poolday/config/lora-training.json). Start the following loopback server on each computer. It checks every shard against the training manifest before accepting a request.

   ```sh
   node tests/fixtures/community-lora-workout-server.mjs /path/to/provisioned/qwen 18383
   ```

2. Start one real signaling service with `npm run start:signaling -- --port 18384`. Make its loopback WebSocket endpoint reachable by each participating browser, for example through an SSH tunnel. Use fresh Chrome profiles on two physical machines and expose their debugging endpoints only through loopback or SSH. The operator driving this test needs permission to opt in both machines. The private room generated for each run has two members.

3. Supply an untracked configuration file to the driver. Each participant's `origin` and `signalingUrl` are resolved on its own machine. The two `endpoint` URLs are resolved on the machine driving the workout. Use a new output directory for each attempt.

   ```json
   {
     "coordinator": {"endpoint":"http://127.0.0.1:18381","origin":"http://127.0.0.1:18383","signalingUrl":"ws://127.0.0.1:18384/signaling"},
     "contributor": {"endpoint":"http://127.0.0.1:18382","origin":"http://127.0.0.1:18383","signalingUrl":"ws://127.0.0.1:18384/signaling"},
     "outputDirectory":"/absolute/path/to/a/new/run"
   }
   ```

   ```sh
   node tests/fixtures/community-lora-two-host.mjs /path/to/private-config.json
   ```

4. Check `workout.json`. The first update uses disjoint target masks over the same prompt, with two supervised positions on one GPU and one on the other. One combined, three-position update on the coordinator provides the numerical reference. The driver compares all 9,216 exported FP32 weights, interrupts the contributor during a second round, checks the retained adapter and optimizer, and resumes on the coordinator. These checks precede the task rounds.

5. The task uses all 32 public tickets in their frozen order, two per round. Step 16 supplies the candidate for comparison with a matched single-computer run. Receive and send counters describe WebRTC training-channel payloads. Count each direction once. Provisioning, signaling and protocol framing have separate costs. The [scoring contract](contract.json) specifies the comparison against the unmodified base and the retention checks. The independent scorer freezes both adapter files and the scoring code before opening the unseen examples.
