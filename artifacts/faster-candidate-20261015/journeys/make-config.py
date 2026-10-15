"""Writes one run-8 (placement C) journey config, in the run-7 schema (reploid.signed-completion-journey-config/v1).
Differences from run-7/config/journey-config-e.json: the frozen bundle, runtime archive (21d054ee...), model
identity (manifest c6220c6a...) and native artifact (final-10); the route mac-host browser stage 0, amd-host
native stage 1 and a second amd-host native stage 2 (harness change H12); the storage acquirer on amd-host;
the loss target amd-host#2 (the output-head stage, as in run 7); the report directory and control module.
Usage: python3 make-config.py <browser bundle sha256:...> <native tarball sha256:...> <stage-0 peer id> <stage-2 peer id> <manifest sha256 hex> <runtime archive sha256 hex> <output>"""
import json, sys
bundle, tarball, stage0, stage2, model, archive, output = sys.argv[1:8]
here = '/Users/xyz/deco/reploid/artifacts/faster-candidate-20261015/journeys'
run = '/var/tmp/reploid-faster-journey-20261015'
config = {
  'schema': 'reploid.signed-completion-journey-config/v1',
  'reportDirectory': here + '/reports',
  'application': {'roomFile': run + '/private-room.json', 'descriptorPath': '/config/browser-bundle-manifest.json',
                  'partitionPolicyPath': '/config/partition-policy.json', 'signalingUrl': None},
  'freeze': {
    'browserBundle': bundle,
    'runtimeArchive': 'sha256:' + archive,
    'modelId': 'qwen-3-5-0-8b-q4k-ehaf16',
    'modelIdentity': 'sha256:' + model,
    'planId': 'sha256:7a4ce534baee0945e47adf13bb3bad017038eebb83b509e9d68b1fe01c76a1bf',
    'planSchema': 'doppler.layer-partition-contract/v3', 'splitLayers': [8, 16],
    'nativeArtifacts': {'amd-host': tarball},
    'route': [
      {'index': 0, 'machine': 'mac-host', 'host': 'browser', 'participantId': stage0},
      {'index': 1, 'machine': 'amd-host', 'host': 'native', 'participantId': 'peer:9af15d884eba51b0c0540e2a', 'orderedConfig': run + '/amd-host-stage-1.json'},
      {'index': 2, 'machine': 'amd-host', 'host': 'native', 'participantId': stage2, 'orderedConfig': run + '/amd-host-stage-2.json'}]},
  'browsers': {
    'requester': {'machine': 'mac-host', 'origin': 'http://127.0.0.1:29670/', 'connect': {'kind': 'launch', 'channel': 'chrome', 'headless': True, 'remoteDebuggingPort': 29672}},
    'coordinator': {'machine': 'mac-host', 'origin': 'http://127.0.0.1:29670/', 'connect': {'kind': 'cdp', 'endpoint': 'http://127.0.0.1:29671'}},
    'storageSupplier': {'machine': 'mac-host', 'origin': 'http://127.0.0.1:29670/', 'connect': {'kind': 'cdp', 'endpoint': 'http://127.0.0.1:29673'}},
    'storageAcquirer': {'machine': 'amd-host', 'origin': 'http://127.0.0.1:29670/', 'connect': {'kind': 'cdp', 'endpoint': 'http://127.0.0.1:29674'}}},
  'contributorControl': {'module': here + '/tools/contributor-control.mjs', 'stopExport': 'stopContributor',
                         'restoreExport': 'restoreContributor', 'lossTarget': 'amd-host#2'},
  'timeouts': {'readyMs': 300000, 'answerMs': 900000, 'lossReportMs': 360000, 'capacityReturnMs': 600000,
               'transferMs': 300000, 'settlementMs': 120000, 'seedingMs': 3600000},
  'observation': {'pollMs': 100},
  'concurrency': {'tabs': 2},
  'modelFiles': {'pathPatterns': ['^/config/model-(manifests|pieces|artifacts)/[0-9a-f]{64}\\.[a-z]+$', '^/qualification/capsule/artifacts/model/']},
  'storage': {'sharingAllowanceMiB': 5, 'stopAllowanceMiB': 64, 'contentionAllowanceMiB': 5, 'interruptionAllowanceMiB': 13,
              'seedingAllowanceMiB': 1200, 'seedingRefusalAllowanceMiB': 64}}
with open(output, 'x') as handle:
    json.dump(config, handle, indent=2); handle.write('\n')
print(output)
