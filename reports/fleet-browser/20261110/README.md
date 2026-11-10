# Fleet browser hosting delivery, November 10

[Hosting receipt](hosting.json) records the static deployment of Reploid
`216ae3e2c0c7fcebbea41833fe8d7e2457254b83` to https://replo.id/.
The release was packaged from a clean ordinary clone while another session
continued editing credits in the shared checkout. Those edits were excluded.

The committed browser bundle passed freshness checks. Firebase deployed 2,404
hosting files. The post-deployment verifier fetched all 2,403 declared bundle
files and matched their bytes to
`sha256:2f9b7c2892794e860c91d041c8017598411f1a95e7e75e6fb50684cd6495d463`.

A fresh Chrome 157 browser checked the private-host pairing controls, separate
download choices, and phone inspector keyboard navigation. No page errors or
weight downloads occurred. [Desktop](desktop.png) and [phone](phone.png)
captures were inspected; the receipt retains their hashes.

Only Firebase Hosting changed. Cloud services and the native coordinator,
requester and contributors were not restarted. No inference request ran during
this production check, and it does not qualify a browser-to-private-fleet
generation or settlement journey on this commit. The earlier private receipts
retain their original source and installed-package scope.

The other session subsequently published `ad179feb0`, adding whole-model
terminal cleanup accounting. That commit is outside this hosting release.
A coordinated native deployment and fresh request/settlement receipt remain
required before claiming that new native release works through public hosting.

Recheck the served bytes from a checkout of the recorded source revision:

```sh
npm run verify:browser-bundle -- --url=https://replo.id
```
