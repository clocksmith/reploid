| Cell | Prompt | Answer asked | Req. | Outcome | Tokens | First token (s) | Decode (ms/token) | Answer (s) | Largest stage call (s) | ICMP RTT median/p90 (ms) | Binding constraint |
|---|---|---|---|---|---|---|---|---|---|---|---|
| c1-p56-n24 | 56 | 63 | 1 | completed | 63 | 22.0 | 2159 | 155.8 | 9.0 | 53.1/123.7 | nearest: answer deadline (17% used) |
| c1-p56-n88 | 56 | 255 | 1 | completed | 255 | 18.6 | 1312 | 351.9 | 8.9 | 31.5/94.7 | nearest: answer deadline (39% used) |
| c1-p256-n24 | 256 | 63 | 1 | completed | 63 | 97.0 | 1369 | 181.9 | 40.8 | 32.7/66.0 | nearest: answer deadline (20% used) |
| c1-p256-n88 | 256 | 255 | 1 | completed | 255 | 85.7 | 1129 | 372.5 | 40.7 | 23.0/55.0 | nearest: answer deadline (41% used) |
| c1-p512-n24 | 512 | 63 | 1 | completed | 63 | 153.4 | 1164 | 225.6 | 82.5 | 23.7/48.3 | nearest: per-stage bound, Mac prefill (27% used) |
| c1-p512-n88 | 512 | 255 | 1 | completed | 255 | 157.9 | 1244 | 473.8 | 82.4 | 23.8/58.7 | nearest: answer deadline (53% used) |
| c1-p1024-n24 | 1024 | 63 | 1 | completed | 63 | 339.4 | 1420 | 427.4 | 184.4 | 35.0/137.1 | nearest: per-stage bound, Mac prefill (61% used) |
| c1-p1024-n88 | 1024 | 255 | 1 | completed | 255 | 339.3 | 1462 | 710.7 | 197.9 | 31.0/176.0 | nearest: answer deadline (79% used) |
| c1-p1588-n24 | 1588 | 63 | 1 | completed | 63 | 487.6 | 1278 | 566.8 | 282.1 | 24.0/99.3 | nearest: per-stage bound, Mac prefill (94% used) |
| c1-p1588-n88 | 1588 | 255 | 1 | completed | 255 | 488.0 | 1328 | 825.4 | 275.6 | 24.0/69.9 | nearest: per-stage bound, Mac prefill (92% used) |
| c2-p56-n24 | 56 | 63 | 2 | completed | 63 | 24.6 | 1383 | 110.3 | 9.0 | 22.6/44.5 | nearest: answer deadline (12% used) |
| c2-p56-n24 | 56 | 63 | 2 | completed | 63 | 33.6 | 1251 | 111.2 | 8.9 | 22.6/44.5 | nearest: answer deadline (12% used) |
| c2-p56-n88 | 56 | 255 | 2 | completed | 255 | 18.7 | 1543 | 410.7 | 9.3 | 25.2/304.3 | nearest: answer deadline (46% used) |
| c2-p56-n88 | 56 | 255 | 2 | completed | 255 | 27.5 | 1510 | 410.9 | 9.1 | 25.2/304.3 | nearest: answer deadline (46% used) |
| c2-p256-n24 | 256 | 63 | 2 | completed | 63 | 121.2 | 1436 | 210.3 | 40.3 | 21.8/50.7 | nearest: answer deadline (23% used) |
| c2-p256-n24 | 256 | 63 | 2 | completed | 63 | 80.0 | 2097 | 210.0 | 41.1 | 21.8/50.7 | nearest: answer deadline (23% used) |
| c2-p512-n88 | 512 | 255 | 2 | completed | 255 | 150.3 | 1572 | 549.6 | 81.4 | 22.4/52.7 | nearest: answer deadline (61% used) |
| c2-p512-n88 | 512 | 255 | 2 | completed | 255 | 235.9 | 1236 | 550.0 | 89.1 | 22.4/52.7 | nearest: answer deadline (61% used) |
| c2-p1588-n24 | 1588 | 63 | 2 | completed | 63 | 502.2 | 6395 | 898.7 | 301.9 | 26.1/95.4 | nearest: per-stage bound, Mac prefill (101% used) |
| c2-p1588-n24 | 1588 | 63 | 2 | completed | 63 | 813.7 | 1389 | 899.8 | 300.9 | 26.1/95.4 | nearest: per-stage bound, Mac prefill (101% used) |
| c3-p56-n24 | 56 | 63 | 3 | completed | 63 | 23.7 | 1348 | 107.2 | 9.0 | 23.1/36.5 | admission: Partition peer declined or failed request |
| c3-p56-n24 | 56 | 63 | 3 | failed: Partition peer declined or failed reques | - | - | - | 6.5 | - | 23.1/36.5 | admission: Partition peer declined or failed request |
| c3-p56-n24 | 56 | 63 | 3 | completed | 63 | 33.0 | 1199 | 107.3 | 8.9 | 23.1/36.5 | admission: Partition peer declined or failed request |
