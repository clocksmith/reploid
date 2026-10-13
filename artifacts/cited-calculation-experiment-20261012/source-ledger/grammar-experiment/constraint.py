"""Installed Transformers prefix masking in the frozen greedy source evaluator."""
import dataclasses,hashlib,inspect,json,time
import numpy as np
import torch
from transformers import PrefixConstrainedLogitsProcessor
from grammar import RowGrammar,TokenTrie

def sha_bytes(value):return hashlib.sha256(value).hexdigest()

class SyntaxConstraint:
    def __init__(self,tokenizer,eos_ids,official_tokenizer=None):
        start=time.monotonic();definition=json.loads(tokenizer.to_str())
        if definition.get('decoder',{}).get('type')!='ByteLevel':raise ValueError('Only inspected ByteLevel decoder is admitted')
        self.tokenizer=tokenizer;self.official_tokenizer=official_tokenizer;self.eos_ids=tuple(eos_ids)
        texts={token:tokenizer.decode([token],skip_special_tokens=False) for token in tokenizer.get_vocab().values()}
        self.trie=TokenTrie(texts,eos_ids);self.enabled=False
        self.identity={'decoder':definition['decoder'],'vocabularySize':len(texts),'asciiTokenCount':len(self.trie.texts),
            'vocabularyTextSha256':sha_bytes(json.dumps(texts,sort_keys=True,separators=(',',':')).encode()),
            'trieConstructionSeconds':time.monotonic()-start}
        self.processor=PrefixConstrainedLogitsProcessor(self.allowed_ids,1)

    def arm(self,schema):
        props=schema[0]['function']['parameters']['properties']
        if schema[0]['function']['name']!='AnnotateSource':raise ValueError('Wrong tool identity')
        facts=props['factRoles'];passages=props['passageRelations']
        if facts['minItems']!=facts['maxItems'] or passages['minItems']!=passages['maxItems']:raise ValueError('Exact row counts required')
        self.grammar=RowGrammar(facts['minItems'],passages['minItems'],facts['items']['items']['enum'],
            passages['items']['items']['enum'],facts['items']['maxItems'],passages['items']['maxItems'])
        self.state=self.grammar.initial();self.generated=[];self.previous={};self.enabled=True

    def disable(self):self.enabled=False

    def allowed_ids(self,batch,prefix):
        if batch!=0 or prefix.tolist()!=self.generated:raise ValueError('Constraint prefix differs from source generation')
        return list(self.current)

    def mask(self,logits,generated,row):
        if not self.enabled:return logits
        started=time.monotonic()
        if len(generated)==len(self.generated)+1 and generated[:-1]==self.generated:
            token=generated[-1]
            if token not in self.previous:raise ValueError('Previous selected token violates recorded grammar')
            self.state=self.previous[token];self.generated=list(generated)
        elif generated!=self.generated:raise ValueError('Unexpected generation reset or prefix')
        decoded=self.tokenizer.decode(generated,skip_special_tokens=False)
        if decoded!=''.join(self.trie.texts[token] for token in generated):
            raise ValueError('Actual prefix decode is not additive; no inaccurate token admission')
        self.current=self.trie.choices(self.grammar,self.state)
        if not self.current:raise ValueError('No grammar continuation; no forced text repair')
        # Check every admitted continuation against full-stream decoding, before sampling.
        # This includes special wrapper tokens and EOS; no isolated-token assumption survives.
        for token in self.current:
            expected=decoded+self.tokenizer.decode([token],skip_special_tokens=False)
            actual=self.tokenizer.decode([*generated,token],skip_special_tokens=False)
            if actual!=expected:raise ValueError('Candidate full-stream decode differs from trie text')
            if self.official_tokenizer is not None:
                official=self.official_tokenizer.decode([*generated,token],skip_special_tokens=False,clean_up_tokenization_spaces=False)
                if official!=actual:raise ValueError('Official full-stream decode differs from admitted continuation')
        # Exclude any unused vocabulary tail, and preserve original pad/penalty masking.
        if any(token>=len(logits) for token in self.current):raise ValueError('Tokenizer/runtime vocabulary mismatch')
        scores=self.processor(torch.tensor([generated],dtype=torch.long),torch.from_numpy(logits.copy()).unsqueeze(0))[0].numpy()
        if not np.isfinite(scores).any():raise ValueError('No finite grammar continuation')
        raw_winner=int(logits.argmax());chosen=int(scores.argmax());terminal=self.grammar.complete(self.state)
        trace=row.setdefault('syntaxConstraint',{'identity':self.identity,'scope':'Syntax/enums/row counts only; no semantic role selection', 'steps':[]})
        trace['steps'].append({'step':len(generated),'allowedCount':len(self.current),
            'allowedIdsSha256':sha_bytes(json.dumps(sorted(self.current),separators=(',',':')).encode()),
            'rawWinner':raw_winner,'selectedToken':chosen,'rawWinnerAllowed':raw_winner in self.current,
            'rawWinnerLogit':float(logits[raw_winner]),'selectedRawLogit':float(logits[chosen]),
            'terminalGrammar':terminal,'eosForcedAgainstRawWinner':terminal and raw_winner not in self.eos_ids,
            'stateSha256':sha_bytes(json.dumps(dataclasses.asdict(self.state),sort_keys=True,separators=(',',':')).encode()),
            'maskSeconds':time.monotonic()-started})
        self.previous=self.current
        return scores

    def finish(self,token_ids):
        if not self.enabled:return
        if not token_ids or token_ids[-1] not in self.eos_ids or token_ids[-1] not in self.previous:
            raise ValueError('No grammar-terminal EOS; output not repaired')
        body=token_ids[:-1]
        text=self.tokenizer.decode(body,skip_special_tokens=False)
        additive=''.join(self.trie.texts[token] for token in body)
        if text!=additive:raise ValueError('ByteLevel decoding is not additive for actual constrained tokens')
        state=self.grammar.advance(self.grammar.initial(),text)
        if state is None or not self.grammar.complete(state):raise ValueError('Decoded output fails grammar')


def install_evaluator(quality,controller,expected_file_sha):
    """One verified token-selection hook; all model/cache/penalty code stays identical."""
    original=quality.evaluate_tasks
    path=inspect.getsourcefile(original)
    if sha_bytes(open(path,'rb').read())!=expected_file_sha:raise ValueError('Source evaluator changed')
    source=inspect.getsource(original)
    needle='''            if greedy:
                token = int(logits.argmax())'''
    replacement='''            if greedy:
                selection_logits = _artifact_syntax_controller.mask(logits, row['tokenIds'], row)
                token = int(selection_logits.argmax())'''
    if source.count(needle)!=1:raise ValueError('Expected one frozen greedy selection site')
    candidate=source.replace(needle,replacement)
    if '_artifact_syntax_controller' in quality.__dict__:raise ValueError('Constraint hook already installed')
    quality.__dict__['_artifact_syntax_controller']=controller
    exec(compile(candidate,path+'#artifact-syntax-hook','exec'),quality.__dict__)
    identity={'baselineFileSha256':expected_file_sha,'baselineFunctionSha256':sha_bytes(source.encode()),
        'candidateFunctionSha256':sha_bytes(candidate.encode()),'replacementCount':1,
        'processorSourceSha256':sha_bytes(open(inspect.getsourcefile(PrefixConstrainedLogitsProcessor),'rb').read())}
    def restore():
        quality.evaluate_tasks=original;quality.__dict__.pop('_artifact_syntax_controller',None)
    return identity,restore
