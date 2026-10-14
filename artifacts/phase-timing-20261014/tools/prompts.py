"""Build the prompt-length ladder for the phase-timing measurement.
Usage: python3 -I prompts.py <tokenizer.json> <distributed-memory-requests.json> > ../config/prompts.json

Document text comes from DR-5's long-prompt workload (tests/fixtures/distributed-memory-requests.json,
request 1: user, assistant, user). The chat UI cannot author an assistant turn, so the three messages
are flattened into one user message as a quoted document; shorter rungs use a whole-word prefix of it. Every rung ends with the same one-sentence instruction so decode stays short while prefill
grows. Token counts here cover the user text only; the application's chat template adds its own
tokens, and the measured prompt length is phases.prompt.inputTokens."""
import hashlib, json, sys
from tokenizers import Tokenizer

tokenizer = Tokenizer.from_file(sys.argv[1])
requests = json.load(open(sys.argv[2]))
messages = requests[1]['messages']
document = '\n\n'.join(f"[{m['role']}]\n{m['content']}" for m in messages)
instruction = '\n\nIn one short sentence, say what the text above is about.'
count = lambda text: len(tokenizer.encode(text, add_special_tokens=False).ids)

def body(copies):
    return '\n\n'.join(f'Copy {n + 1} of the document:\n{document}' if copies > 1 else document for n in range(copies))

def trimmed(target):
    # Longest document prefix (whole words) whose text plus instruction stays within the target.
    words, lo, hi = body(3).split(' '), 1, None
    hi = len(words)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if count(' '.join(words[:mid]) + instruction) <= target: lo = mid
        else: hi = mid - 1
    return ' '.join(words[:lo]) + instruction

rungs = [
    ('short', 'In one short sentence, what is the capital of France?'),
    ('t256', trimmed(256)),
    ('t1024', trimmed(1024)),
    ('dr5-flattened', document + instruction),
]  # Fixed ladder: about 40, 256, 1024 and 1588 prompt tokens; nothing above 1588 (coordinator correction).
out = {'schema': 'reploid.phase-timing-prompts/v1',
       'source': 'tests/fixtures/distributed-memory-requests.json request 1 (sha256 of fixture recorded by caller), flattened',
       'tokenizer': 'artifacts/model/tokenizer.json of Capsule qwen35-capsule-completion-20261013-c (user text only, no template)',
       'instruction': instruction.strip(),
       'rungs': [{'id': rid, 'userTextTokens': count(text), 'characters': len(text),
                  'sha256': hashlib.sha256(text.encode()).hexdigest(), 'text': text} for rid, text in rungs]}
json.dump(out, sys.stdout, indent=1)
