# Reploid

A network where people and agents combine models, tools, storage, and compute.
Chat is the first interface; each participant controls contribution and disclosure.

**[Try Reploid](https://replo.id/)** · [Get started](docs/QUICK-START.md) · [Documentation](docs/INDEX.md)

## Get started

From a repository checkout, install and start the browser application:

```sh
npm install
npm start
```

Open `http://localhost:8000`. Choose an available model, ask a question, and review
recipients before sharing inputs. A prepared peer can execute without requester
weight downloads. Local execution separately requires WebGPU and model files.

Conversations remain independent. After interruption, keep the partial answer
and explicitly retry. Storage and compute contribution are optional, with their
own permissions and limits. See the [conversation contract](docs/chat-mvp.md).

## Technical architecture

### Component ownership

Reploid coordinates; Doppler computes; Poolday transport connects participants.
This diagram shows the two-partition path, not a deployment qualification.

```mermaid
flowchart TB
    USER["Conversation<br/>requester needs no model weights"] --> COORD["Reploid<br/>discover, authorize and assign"]
    COORD --> A["Contributor A<br/>Doppler partition 0"]
    COORD --> B["Contributor B<br/>Doppler partition 1"]
    STORE["Verified model pieces"] -->|assigned pieces| A
    STORE -->|assigned pieces| B
    A -->|activations| B
    B -->|selected token for next step| A
    B -->|identified output| COORD
    COORD -->|stream answer| USER
    classDef contract fill:#f3edff,stroke:#7c3aed,color:#111827
    classDef resource fill:#edf3ff,stroke:#2563eb,color:#111827
    classDef compute fill:#fff0f3,stroke:#e11d48,color:#111827
    class COORD contract
    class STORE resource
    class A,B compute
```

Storage sharing, whole requests, model partitions, and agent subtasks retain
distinct contracts. Introduction or transport access grants no compute or
input-disclosure permission.

### Attempt failure and recovery

Every attempt has its own identity, output, and cancellation boundary.

```mermaid
flowchart TB
    ADMIT["Authorize and admit attempt"] --> RUN["Prepare and execute"]
    RUN -->|complete| DONE["Retain answer<br/>and outcome"]
    RUN -->|Stop| CANCEL["Cancel identified work<br/>await owned cleanup"]
    CANCEL --> STOPPED["Keep partial answer<br/>and stop reason"]
    RUN -->|error or peer loss| PARTIAL["Keep partial answer<br/>and error"]
    PARTIAL -->|explicit Retry| NEW["New authorized attempt"]
    STOPPED -->|explicit Retry| NEW
    NEW --> ADMIT
    classDef contract fill:#f3edff,stroke:#7c3aed,color:#111827
    classDef resource fill:#edf3ff,stroke:#2563eb,color:#111827
    classDef compute fill:#fff0f3,stroke:#e11d48,color:#111827
    class ADMIT,NEW contract
    class DONE,STOPPED,PARTIAL resource
    class RUN,CANCEL compute
```

A lost connection does not prove GPU cleanup. Restart creates a new attempt;
saved outcomes do not restore model execution state. Other conversations keep
their own progress and histories.

## Evidence

Partition execution is implemented; complete numerical and application
qualification remains open. The [surface claim index](docs/status/surface-claim-index.json)
records supported scopes and unresolved gates. Cross-host rendezvous still
requires signaling; a receipt alone does not prove honest execution.

Improvement is a separate workflow: independently evaluate changes, authorize
reversible adoption, then measure results. Model confidence never grants authority.
See [improvement episodes](docs/rsi-improvement-episodes.md).

## Read next

- [Architecture](docs/open-mesh-architecture.md) — coordination, custody, and recovery.
- [Security](docs/SECURITY.md) — permission and trust boundaries.
- [Zero and X](docs/zero-x-quick-start.md) — optional agent configurations.
- [Goals](GOALS.md) · [Contributing](AGENTS.md) — priorities and component ownership.

## License

[MIT](LICENSE).
