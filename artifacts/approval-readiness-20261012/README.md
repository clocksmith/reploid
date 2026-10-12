# Revalidate capacity after reviewing disclosure

Component: automatic partition coordination. Intent: preserved.

An ordinary physical requester waited 54 seconds before approving Suby + native
Node execution. The entry descriptor expires after 10 seconds; generation then
failed with `Refresh an available entry before requesting execution`. The earlier
attempt remains in the conversation. Immediate explicit retry completed through
both physical partitions; this did not repair the human review boundary.

The regression waits longer than its descriptor TTL before approval, then tries
the same request. Before the repair both fixture variants fail at that exact
entry check. After approval, Reploid now refreshes the selected entry and requires
the identical model identity, plan and recipients before sending the reviewed
message snapshot. Changed placement requires reviewing a new attempt. Consent
expiry remains the original expiry and is checked before and after refresh;
cancellation still prevents sending. No approval or generation is replayed.

44 partition API and placement checks pass. They include actual delayed approval,
expired consent, mutation of the caller's messages during review, and contributor
replacement while review is open. The test fixture polls every 50 ms instead of
10 ms so its intentional human delay stays inside its existing 128-message budget;
production timing, limits and grants are unchanged. Tests use injected execution.
Physical control and actual Worker receipts are retained alongside this report
when run; they do not establish numerical or model-quality qualification.
