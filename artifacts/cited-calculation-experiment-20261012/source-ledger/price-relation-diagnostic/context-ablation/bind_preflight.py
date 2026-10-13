from pathlib import Path
import json
root=Path(__file__).resolve().parent;f=json.loads((root/'input.json').read_text());pre=json.loads((root/'token-preflight.json').read_text())
f['priorAccounting']={'promptTokens':0,'generatedTokens':0,'totalChargedTokens':0,'rawUtf16':0}
f['occurrences']=[{'rowIndex':i,'arm':a['id'].split('-',2)[2],'occurrence':pair['sourceOccurrence'],'messages':a['messages']} for i,pair in enumerate(f['pairs']) for a in pair['arms']]
f['inputIds']=[r['inputIdsSha256'] for r in pre['rows']]
(root/'input.json').write_text(json.dumps(f,indent=2)+'\n')
