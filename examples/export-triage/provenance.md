# Export triage case provenance

The study uses short, fictional reports about a specific support decision. Queue A handles a defect in an exported file. Queue B handles an export preview, dialog or summary that misrepresents a correct file. The ticket shown to the model omits the internal queue mapping. The public training rows teach that mapping.

All 32 training tickets, 24 evaluation tickets and 12 general-knowledge controls were composed for this study. They contain invented situations and values. There are no customer records, issue-tracker extracts or third-party passages. These original case texts and labels are intended for public redistribution under the repository license in [LICENSE](../../LICENSE).

The case author composed and sealed the evaluation set before writing the training records. The two splits use separately written reports and distinct case identifiers. The case author prepared both sets and did not build the adapter or scorer. Only the training set may be used for training or model selection. The holdout envelope uses AES-256-GCM. The scorer verifies the plaintext digest in [contract.json](contract.json) before evaluation. The release owner records the independent scorer revision and artifact hashes separately.

The task measures how well the model learns these queue assignments for fictional tickets. Production ticket routing and broad model retention require additional evidence.
