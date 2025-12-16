# Semantic Memory

## How Reploid Uses It

Reploid's agent loop enriches every LLM call with relevant memories. This pattern is formally known as **Memory-Augmented Generation** or **Reflexion**, where agents "recall" past experiences before acting [[Park et al., 2023, "Generative Agents"](https://arxiv.org/abs/2304.03442); [Shinn et al., 2023, "Reflexion"](https://arxiv.org/abs/2303.11366)].

```javascript
// Before each LLM call (agent-loop.js:351)
if (CognitionAPI) {
  context = await CognitionAPI.semantic.enrich(userMessage, context);
}
```

**The enrich() function:**

1. **Embeds the user query → 384-dim vector:** Compresses intent into dense vector space.
2. **Searches IndexedDB for similar memories (cosine > 0.5):** Uses **Approximate Nearest Neighbor (ANN)** search [[Malkov & Yashunin, 2018](https://arxiv.org/abs/1603.09320)].
3. **Injects top 3 matches as system message:** This technique is often called **Few-Shot Prompting via Retrieval** [[Lewis et al., 2020, "RAG"](https://arxiv.org/abs/2005.11401)].

```javascript
// semantic-memory.js
const enrich = async (query, context) => {
  const memories = await search(query, { topK: 3 });
  context.splice(insertIdx, 0, {
    role: 'system',
    content: `Relevant context from memory:\n${memories.map(m => m.content).join('\n')}`
  });
  return context;
};
```

**Auto-learns during idle time:** This aligns with **"Offline Memory Consolidation"** in autonomous agents, where findings are summarized and stored to long-term memory [[Packer et al., 2023, "MemGPT"](https://arxiv.org/abs/2310.08560)].

---

## Why: Meaning vs Words

**Query:** "bypass authentication"
**Memory:** "SQL injection in login field grants admin"

| Approach | Result | Explanation |
|----------|--------|-------------|
| **Text RAG** | 0 word overlap → NO MATCH | This is the **"Vocabulary Mismatch Problem"** [[Lin et al., 2021](https://arxiv.org/abs/2010.00768)] |
| **Semantic** | 0.82 similarity → MATCH | Uses **Dense Retrieval**, mapping synonyms ("bypass" ≈ "injection") to the same vector space [[Karpukhin et al., 2020, "DPR"](https://arxiv.org/abs/2004.04906)] |

The embedding model compresses meaning into vectors. Similar concepts land nearby regardless of words used.

---

## RAG vs Semantic

| | Text RAG | Semantic |
|---|----------|----------|
| **Matches** | Words | Meaning |
| "bypass login" finds "SQLi grants admin" | No | Yes |
| "steal session" finds "XSS in search" | No | Yes |

Both store vectors. Both grow over time. The difference is the similarity measure: **Lexical Overlap (Sparse)** vs **Conceptual Distance (Dense)**.

---

## Implementation (Python)

Uses **Sentence-BERT (SBERT)**, the industry standard for mapping sentences to vector space [[Reimers & Gurevych, 2019](https://arxiv.org/abs/1908.10084)].

```python
from sentence_transformers import SentenceTransformer
import chromadb

# "all-MiniLM-L6-v2" is a distilled model optimized for speed/performance balance
# [Wang et al., 2020, "MiniLM"](https://arxiv.org/abs/2002.10957)
model = SentenceTransformer('all-MiniLM-L6-v2')

db = chromadb.PersistentClient("./mem")
col = db.get_or_create_collection("findings")

def store(text, phase):
    # Deterministic hashing ensures deduplication
    col.add(ids=[f"{hash(text)%10**8}"], documents=[text], metadatas=[{"phase": phase}])

def recall(query, k=5):
    # Uses HNSW (Hierarchical Navigable Small World) index for <10ms retrieval
    return col.query(query_texts=[query], n_results=k)["documents"][0]

def enrich(task, prompt):
    return prompt + "\n\nPast findings:\n" + "\n".join(recall(task))
```

---

## Web Pentest Memories

This application of RAG to cybersecurity is known as **"Automated Vulnerability Management with LLMs"** [[AutoPentest, 2025](https://arxiv.org/abs/2505.10321v1)].

```python
store("' OR '1'='1 bypasses login - blind SQLi confirmed", "auth")
store("JWT uses HS256 with weak secret 'password123'", "auth")
store("IDOR on /api/user/{id} leaks other users' data", "access")
store("File upload accepts .php.jpg - shell at /uploads/", "upload")
store("<svg/onload=alert(1)> stored in search field", "xss")
```

---

## In Action

```python
task = "need to access admin panel"
# Returns: SQLi bypass, JWT weak secret (no word overlap, meaning matches)
```

**Why it works:** The model has learned that "admin panel" is semantically close to "login bypass" and "privilege escalation" from pre-training on large web corpora (CommonCrawl).

```python
task = "found file upload"
# Returns: .php.jpg shell technique

task = "inject javascript"
# Returns: XSS in search field
```
