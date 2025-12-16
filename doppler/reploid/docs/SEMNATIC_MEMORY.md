Semantic Memory vs Text-Based RAG

  Core Difference

  Both grow over time. The difference is what matches.

  # Text RAG: word overlap required
  query = "bypass authentication"
  stored = "SQL injection in username field grants admin access"
  # BM25 score: LOW (no shared words)

  # Semantic: meaning matches
  query_vec = embed("bypass authentication")
  stored_vec = embed("SQL injection in username field grants admin access")
  # cosine_similarity: 0.82 (same concept)

  ---
  Retrieval Mechanism

  Text RAG (BM25/TF-IDF)
  score = sum(
      TF(word, doc) * IDF(word, corpus)
      for word in query.split()
      if word in doc
  )
  # No shared words = zero score

  Semantic
  score = dot(query_embedding, doc_embedding) / (norm(q) * norm(d))
  # Conceptual similarity, words don't matter

  ---
  What This Means

  | Query                | Stored Finding           | Text RAG | Semantic |
  |----------------------|--------------------------|----------|----------|
  | "bypass login"       | "SQLi grants admin"      | ❌ 0.0   | ✅ 0.81  |
  | "steal cookies"      | "XSS in search field"    | ❌ 0.0   | ✅ 0.77  |
  | "get source code"    | "LFI via path traversal" | ❌ 0.0   | ✅ 0.73  |
  | "access other users" | "IDOR on /api/user/id"   | ❌ 0.1   | ✅ 0.84  |

  Text RAG needs word overlap. Semantic needs meaning overlap.

  ---
  Granularity

  Text RAG: stores chunks (what you fed it)
  store("Nmap scan completed. Port 80 open running Apache 2.4.49. "
        "Port 443 open with SSL certificate for example.com. "
        "Port 22 filtered. OS detection suggests Ubuntu...")

  Semantic: stores facts (what you learned)
  store("Apache 2.4.49 on port 80 - vulnerable to path traversal CVE-2021-41773")
  store("SSH filtered - likely firewall, try port knocking")

  Both grow. Semantic is denser signal.

  ---
  Same Storage, Different Retrieval

  # You can use the same DB for both
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

  The embedding model is the difference, not the storage.

  ---
  When Each Wins

  | Use Case                 | Better Choice               |
  |--------------------------|-----------------------------|
  | "Find all SQLi findings" | Text (exact match)          |
  | "How do I get admin?"    | Semantic (conceptual)       |
  | "Show port 443 results"  | Text (specific term)        |
  | "Escalate from webshell" | Semantic (technique recall) |

  ---
  Bottom Line

  Both can grow. Both use vector DBs. The difference:

  - Text RAG: matches words
  - Semantic: matches meaning

  # This is the only difference
  text_rag_score = keyword_overlap(query, doc)
  semantic_score = cosine_sim(embed(query), embed(doc))
