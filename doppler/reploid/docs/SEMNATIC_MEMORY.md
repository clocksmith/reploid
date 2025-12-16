Here is the annotated version with authoritative sources added inline.

#Semantic Memory vs Text-Based RAG (Annotated)###Core DifferenceBoth grow over time. The difference is what matches.

**Text RAG: word overlap required**
`query = "bypass authentication"`
`stored = "SQL injection in username field grants admin access"`

* **BM25 score:** LOW (no shared words). This is known as the **"Vocabulary Mismatch Problem"** in Information Retrieval [[Furnas et al., 1987](https://dl.acm.org/doi/10.1145/32206.32212)].

**Semantic: meaning matches**
`query_vec = embed("bypass authentication")`
`stored_vec = embed("SQL injection in username field grants admin access")`

* **Cosine similarity:** 0.82 (same concept). This relies on **Dense Vector Retrieval**, typically using Transformer models like BERT or Sentence-BERT [[Reimers & Gurevych, 2019](https://arxiv.org/abs/1908.10084)].

---

###Retrieval Mechanism**Text RAG (BM25/TF-IDF)**
The standard probabilistic scoring method [[Robertson et al., 2009](https://dl.acm.org/doi/10.1561/1500000019)].

```python
score = sum(
    TF(word, doc) * IDF(word, corpus)
    for word in query.split()
    if word in doc
)
# No shared words = zero score

```

**Semantic**
Uses high-dimensional vector space models (VSM) [[Salton et al., 1975](https://dl.acm.org/doi/10.1145/361219.361220)].

```python
score = dot(query_embedding, doc_embedding) / (norm(q) * norm(d))
# Conceptual similarity, words don't matter

```

---

###What This Means| Query | Stored Finding | Text RAG | Semantic |
| --- | --- | --- | --- |
| "bypass login" | "SQLi grants admin" | ❌ 0.0 | ✅ 0.81 |
| "steal cookies" | "XSS in search field" | ❌ 0.0 | ✅ 0.77 |
| "get source code" | "LFI via path traversal" | ❌ 0.0 | ✅ 0.73 |
| "access other users" | "IDOR on /api/user/id" | ❌ 0.1 | ✅ 0.84 |

**Text RAG** needs word overlap (exact lexical match).
**Semantic** needs meaning overlap (vector proximity).

> **Note:** While Semantic wins on concepts, it can fail on exact matches (e.g., serial numbers, specific error codes, or version numbers like "CVE-2023-1234"). This is why **Hybrid Search** is often preferred [[Karpukhin et al., 2020](https://arxiv.org/abs/2004.04906)].

---

###Granularity**Text RAG: stores chunks (what you fed it)**
Standard RAG splits documents into fixed windows (e.g., 512 tokens) or recursive chunks [[Lewis et al., 2020](https://arxiv.org/abs/2005.11401)].

```text
store("Nmap scan completed. Port 80 open running Apache 2.4.49. "
      "Port 443 open with SSL certificate for example.com. "
      "Port 22 filtered. OS detection suggests Ubuntu...")

```

**Semantic: stores facts (what you learned)**
Advanced agentic memory uses **Propositional Retrieval** or **Knowledge Graphs** to store atomic facts rather than raw text [[Chen et al., 2023](https://arxiv.org/abs/2312.06648); [Microsoft GraphRAG, 2024](https://arxiv.org/abs/2404.16130)].

```text
store("Apache 2.4.49 on port 80 - vulnerable to path traversal CVE-2021-41773")
store("SSH filtered - likely firewall, try port knocking")

```

Both grow. Semantic is a denser signal.

---

###Same Storage, Different Retrieval**You can use the same DB for both**
Modern vector databases (Chroma, Weaviate, Pinecone, pgvector) support "Hybrid Search" (Sparse + Dense vectors).

```python
collection = chroma.get_collection("findings")

# Text search (BM25-style via where_document)
collection.query(
    query_texts=["authentication bypass"],
    where_document={"$contains": "bypass"}  # keyword filter
)

# Semantic search (embedding similarity)
collection.query(
    query_texts=["authentication bypass"]  # no filter, pure similarity
)

```

The embedding model is the difference, not the storage.

---

###When Each Wins| Use Case | Better Choice | Source/Reason |
| --- | --- | --- |
| "Find all SQLi findings" | **Text** (exact match) | Precision on technical terms is higher [[Thakur et al., 2021](https://arxiv.org/abs/2104.08663)]. |
| "How do I get admin?" | **Semantic** (conceptual) | Captures intent/synonyms. |
| "Show port 443 results" | **Text** (specific term) | Numbers/identifiers often confuse embeddings. |
| "Escalate from webshell" | **Semantic** (technique recall) | Generalizes "webshell" to specific file types (php/jsp). |

---

###Bottom LineBoth can grow. Both use vector DBs. The difference:

* **Text RAG:** matches words (Lexical)
* **Semantic:** matches meaning (Latent)

**This is the only difference:**

```python
text_rag_score = keyword_overlap(query, doc)
semantic_score = cosine_sim(embed(query), embed(doc))

```
