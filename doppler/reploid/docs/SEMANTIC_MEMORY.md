# Semantic Memory

## Why Semantic

| | Text RAG | Semantic |
|---|----------|----------|
| **Matches** | Words | Meaning |
| "bypass login" finds "SQLi grants admin" | No | Yes |
| "steal session" finds "XSS in search" | No | Yes |

Both store vectors. The difference: **Lexical Overlap** vs **Conceptual Distance**.

## Python vs Reploid

| | Python | Reploid |
|---|--------|---------|
| **Embedding** | sentence-transformers | Transformers.js |
| **Storage** | ChromaDB | IndexedDB |
| **Runtime** | Server | Browser (offline) |

### Python

```python
from sentence_transformers import SentenceTransformer
import chromadb

model = SentenceTransformer('all-MiniLM-L6-v2')
db = chromadb.PersistentClient("./mem")
col = db.get_or_create_collection("findings")

def store(text, meta={}):
    col.add(ids=[f"{hash(text)%10**8}"], documents=[text], metadatas=[meta])

def recall(query, k=5):
    return col.query(query_texts=[query], n_results=k)["documents"][0]
```

### Reploid

```javascript
// Transformers.js + IndexedDB
const store = async (text, metadata = {}) => {
  const embedding = await embed(text);
  await EmbeddingStore.addMemory({ content: text, embedding, ...metadata });
};

const search = async (query, topK = 5) => {
  const embedding = await embed(query);
  return EmbeddingStore.searchSimilar(embedding, topK, 0.5);
};
```

## Examples

```python
store("' OR '1'='1 bypasses login - SQLi", {"cat": "web"})
store("SSH key in .git/config - lateral movement", {"cat": "infra"})
store("Docker socket exposed - container escape", {"cat": "infra"})

recall("need admin access")      # → SQLi bypass
recall("move between systems")   # → SSH key leak
recall("escape sandbox")         # → Docker socket
```

## References

- [Sentence-BERT](https://arxiv.org/abs/1908.10084)
- [RAG](https://arxiv.org/abs/2005.11401)
- [MemGPT](https://arxiv.org/abs/2310.08560)
