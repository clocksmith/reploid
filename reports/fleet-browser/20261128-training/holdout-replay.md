# Replay the scored cases

From the repository root, start the pinned model server and coordinator browser as described in the [workout instructions](../../../examples/export-triage/README.md), then run the frozen scorer on the archived adapters in a fresh directory with the released case key.

```sh
lora_report=reports/fleet-browser/20261128-training
lora_replay=$(mktemp -d)
cp -R "$lora_report/task" "$lora_report/task-reference" "$lora_report/workout.json" "$lora_report/score-freeze.json" "$lora_replay"
node tests/fixtures/community-lora-two-host-score.mjs score \
  --run-dir "$lora_replay" \
  --freeze-sha256 e91c1365f2e4dd1b6b4a300551c34eb00ab6614f1ee586175bc83374275d1fb6 \
  --key-file "$lora_report/holdout-replay-key.txt"
```
