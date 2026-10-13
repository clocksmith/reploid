"""Read-only source API/tokenizer/cache inspection; never constructs a neural model."""
import argparse,hashlib,inspect,json,sys
from pathlib import Path
import torch
from tokenizers import Tokenizer
from transformers import AutoConfig,AutoTokenizer
from transformers.models.qwen3.modeling_qwen3 import Qwen3Model,Qwen3ForCausalLM
p=argparse.ArgumentParser()
for name in ['root','source','doppler','result','out']:p.add_argument('--'+name,required=True)
a=p.parse_args();root=Path(a.root);source=Path(a.source);sys.path.insert(0,str(Path(a.doppler)/'tools'));sys.path.insert(0,str(root.parent))
from lib import source_task_quality as quality
from constraint_adapter import PriceConstraint
from contract import DEFINITIONS
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();r=json.loads(Path(a.result).read_text());suite=json.loads((root/'suite.json').read_text());fixture=json.loads((root/'input.json').read_text())
q=Tokenizer.from_file(str(source/'tokenizer.json'));official=AutoTokenizer.from_pretrained(source,local_files_only=True,trust_remote_code=False);config=AutoConfig.from_pretrained(source,local_files_only=True)
checks=[];suffix='<|im_start|>assistant\n<think>\n\n</think>\n\n'
for task,item,call in zip(suite['cases'],fixture['occurrences'],r['calls'],strict=True):
 result=call['result'];messages=quality.task_messages(task,suite)
 assert messages==item['messages']==result['messages']
 rendered=official.apply_chat_template(messages,tokenize=False,add_generation_prompt=True,enable_thinking=False)
 assert rendered==result['renderedPrompt'] and rendered.endswith(suffix)
 ids=q.encode(rendered,add_special_tokens=False).ids
 assert ids==official.encode(rendered,add_special_tokens=False)==result['inputIds']
 assert q.decode(ids,skip_special_tokens=False)==rendered
 assert len(ids)+suite['generation']['maxTokens']<=suite['generation']['maxSeqLen']<=config.max_position_embeddings
 assert result['tokenIds'][-1]==config.eos_token_id==151645
 checks.append({'id':task['id'],'exactMessagesRenderAndIds':True,'closedNonthinkingPrefix':True,'promptTokens':len(ids),'generationTokens':len(result['tokenIds']),'eos':result['tokenIds'][-1]})
controller=PriceConstraint(q,[151645,151643],official);controller.arm();assert controller.state.prefix=='' and controller.generated==[] and controller.previous=={}
assert set(json.loads(x)['relation'] for x in controller.grammar.outputs)==set(DEFINITIONS)
controller.state=controller.grammar.advance(controller.state,'{"relation":"quoted');controller.generated=[1];controller.arm()
assert controller.state.prefix=='' and controller.generated==[] and controller.previous=={}
cache=quality.StoredHalfCache(config=config);fresh=quality.StoredHalfCache(config=config)
assert cache.get_seq_length()==fresh.get_seq_length()==0
keys=torch.linspace(-0.75,0.75,3*8*128).reshape(1,8,3,128);values=-keys
k,v=cache.update(keys,values,0);assert k.dtype==v.dtype==torch.float32 and torch.equal(k,keys.half().float()) and torch.equal(v,values.half().float())
assert cache.get_seq_length()==3 and fresh.get_seq_length()==0
loader=Path(a.doppler)/'tools/source-model-task-quality.py';evaluator=Path(inspect.getsourcefile(quality.evaluate_tasks));model_file=Path(inspect.getsourcefile(Qwen3Model));model_forward=inspect.getsource(Qwen3Model.forward)
assert 'past_key_values.get_seq_length()' in model_forward and 'create_causal_mask' in model_forward
report={'schema':'reploid.price-context-source-api-audit/v1','neuralModelConstructed':False,'newGenerationCalls':0,'sourceOutputSha256':sha(a.result),'rows':checks,
 'observedFiles':{str(x):sha(x) for x in [loader,evaluator,source/'config.json',source/'tokenizer_config.json',source/'tokenizer.json',model_file]},
 'template':'Actual retained official template explicitly emits closed empty think block when enable_thinking=false. Exact source and official tokenizer IDs, complete input roundtrip, assistant prefix and bounds reproduce all18 recorded calls.',
 'policy':{'temperature':0,'topK':1,'topP':1,'repetitionPenalty':1.0,'presencePenalty':0,'maxTokens':64,'padsAndStops':'Tokenizer pad151643 also allowed as terminal EOS by frozen suite; every observed output ends with canonical configEOS151645. No alternate pad stop occurred.','qualification':'This is the declared greedy policy, not a claim to match all upstream model.generate defaults or recommended quality sampling.'},
 'state':'Frozen evaluator creates StoredHalfCache, history and complete input IDs inside each task loop. First call receives all prompt IDs; subsequent calls receive exactly the prior generated token. Real cache storage/reset control confirms independent fresh instances and declared F16 rounding. Installed Qwen3Model derives positions from cache sequence length and creates its causal mask for unpadded inputs; logits_to_keep1 selects the last input position.',
 'grammar':'Arm resets prefix/generated/previous each call; all seven labels are globally legal. All actual allowed-ID hashes reproduced separately in token-audit.json. Earlier compact JSON removes a preferred whitespace; therefore this remains a constrained-policy result, not an unconstrained counterfactual.',
 'arithmeticLimit':'Original checkpoint metadata declares bfloat16. Frozen evaluator deliberately represents original weights in F32 and stores K/V in F16; this policy was declared and unchanged. It does not establish identical behavior to upstream default BF16 generation.',
 'discrepancyFound':False,'causeConclusion':'No concrete dropped-input, wrong template, stale cache, wrong last-logit selection or semantic-option omission found. These checks do not prove intrinsic model weakness, exclude arithmetic sensitivity, or isolate the effect of prior syntactic masking. No further treatment selected.'}
Path(a.out).write_text(json.dumps(report,indent=2)+'\n')
