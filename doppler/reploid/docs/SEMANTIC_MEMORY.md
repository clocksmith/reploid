# Semantic Memory

## How Reploid Uses It

Reploid enriches every LLM call with relevant memories before acting:

```javascript
// agent-loop.js - before each LLM call
if (CognitionAPI) {
  context = await CognitionAPI.semantic.enrich(userMessage, context);
}
```

The `enrich()` function:
1. Embeds the query into a 384-dim vector
2. Searches IndexedDB for similar memories (cosine > 0.5)
3. Injects top matches as system context

This lets the agent recall past findings, tool outputs, and learned patterns without explicit prompting.

## Why Semantic Over Keywords

**Query:** "bypass authentication"
**Memory:** "SQL injection in login field grants admin"

| Approach | Result |
|----------|--------|
| Keyword search | No match (0 word overlap) |
| Semantic search | 0.82 similarity → MATCH |

The embedding model maps meaning, not words. "bypass" and "injection" land in the same vector neighborhood.

## Security Applications

Semantic memory excels at connecting related security concepts:

```python
from sentence_transformers import SentenceTransformer
import chromadb

model = SentenceTransformer('all-MiniLM-L6-v2')
db = chromadb.PersistentClient("./mem")
findings = db.get_or_create_collection("findings")

def store(text, category):
    findings.add(ids=[f"{hash(text)%10**8}"], documents=[text], metadatas=[{"cat": category}])

def recall(query, k=5):
    return findings.query(query_texts=[query], n_results=k)["documents"][0]
```

<<<<<<< HEAD
---

## Reploid Security Memory Exmaples

This application of RAG to cybersecurity is known as **"Automated Vulnerability Management with LLMs"** [[AutoPentest, 2025](https://arxiv.org/abs/2505.10321v1)].

=======
**Example memories:**
>>>>>>> 97ee3996 (.)
```python
# Web security
store("' OR '1'='1 bypasses login - blind SQLi", "web")
store("<svg/onload=alert(1)> stored in search field", "web")

# Infrastructure
store("SSH key in .git/config - lateral movement possible", "infra")
store("Docker socket exposed - container escape via mount", "infra")

# Code review
store("eval(user_input) in parser.js line 42", "code")
store("Hardcoded AWS keys in config.py", "code")
```

**Queries that match without keyword overlap:**
- "need admin access" → finds SQLi bypass
- "move between systems" → finds SSH key leak
- "escape sandbox" → finds Docker socket exposure
- "secrets in repo" → finds hardcoded AWS keys

The model learned these associations from pre-training on security corpora, documentation, and code.

## References

- [RAG: Retrieval-Augmented Generation](https://arxiv.org/abs/2005.11401)
- [Sentence-BERT](https://arxiv.org/abs/1908.10084)
- [MemGPT: Memory Management for LLMs](https://arxiv.org/abs/2310.08560)
