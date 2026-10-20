/** Read persisted browser history, including canonical publication text. */
export const readChatWorkspace = page => page.evaluate(async () => {
  const open = indexedDB.open('reploid-requester-history');
  const db = await new Promise((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
  try {
    const request = db.transaction('conversations', 'readonly').objectStore('conversations').get('workspace');
    const record = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    if (!record) return null;
    // Ordered storage deliberately keeps text in publication records, outside metadata.
    for (const thread of record.workspace.threads) {
      const publications = record.publications[thread.id]?.records ?? [];
      for (const attempt of thread.attempts.filter(row => row.publicationMode === 'canonical')) {
        const message = thread.messages.find(row => row.id === attempt.responseId);
        message.content = publications.filter(row => row.publication.attemptId === attempt.id)
          .map(row => row.publication.delta?.text ?? '').join('');
      }
    }
    return record.workspace;
  } finally { db.close(); }
});
