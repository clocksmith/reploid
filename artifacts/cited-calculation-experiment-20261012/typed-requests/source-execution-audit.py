"""Post-result evaluator-boundary audit. No model weights or generation research."""
import argparse
import copy
import hashlib
import inspect
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace

parser=argparse.ArgumentParser()
for name in ['doppler','source','result','out']:parser.add_argument('--'+name,required=True)
args=parser.parse_args()
sys.path.insert(0,str(Path(args.doppler)/'tools'))
from lib import source_task_quality as quality
import torch
from transformers import AutoTokenizer
from transformers.models.qwen3_5.configuration_qwen3_5 import Qwen3_5TextConfig
from transformers.models.qwen3_5 import modeling_qwen3_5 as implementation
import transformers.cache_utils as cache_implementation
from tokenizers import Tokenizer

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
r=json.loads(Path(args.result).read_text());calls=r['cases'][0]['calls']
root=Path(__file__).resolve().parent
suite=json.loads((root/'suite.json').read_text())
assert digest(Path(quality.__file__))==r['evaluatorSha256']
source=Path(args.source)
config=Qwen3_5TextConfig(**json.loads((source/'config.json').read_text())['text_config'])
tokenizer=Tokenizer.from_file(str(source/'tokenizer.json'))
official=AutoTokenizer.from_pretrained(source,local_files_only=True)
assert hashlib.sha256(official.chat_template.encode()).hexdigest()==r['actualTemplateSha256']
observed=[];held=[]
class Probe:
    def __call__(self,*,input_ids,past_key_values,use_cache,logits_to_keep):
        ids=input_ids[0].tolist();expected=calls[len(observed)]['inputIds']
        assert ids==expected
        assert past_key_values.get_seq_length()==0
        assert all(not past_key_values.has_previous_state(i) for i in range(config.num_hidden_layers) if config.layer_types[i]=='linear_attention')
        assert all(past_key_values is not prior for prior in held)
        observed.append({'inputTokens':len(ids),'forwardTensorEqualsRetainedPrompt':True,'initialAttentionLength':past_key_values.get_seq_length(),'freshRecurrentStates':True,'distinctCacheObject':True,'useCache':use_cache,'logitsToKeep':logits_to_keep})
        held.append(past_key_values)
        logits=torch.zeros((1,1,config.vocab_size),dtype=torch.float32);logits[0,0,suite['eosTokenIds'][0]]=1
        return SimpleNamespace(logits=logits)
class BoundTokenizer:
    def __init__(self,schema):self.schema=schema
    def apply_chat_template(self,messages,**options):return official.apply_chat_template(messages,tools=self.schema,**options)
    def __getattr__(self,name):return getattr(official,name)
original=quality.task_messages
with tempfile.TemporaryDirectory() as temp:
    for index,call in enumerate(calls):
        quality.task_messages=lambda task,unused,call=call:copy.deepcopy(call['messages'])
        stage=copy.deepcopy(suite);stage['cases']=[stage['cases'][0]];stage['generation']['maxTokens']=1
        report={'results':[]};quality.evaluate_tasks(Probe(),config,tokenizer,BoundTokenizer(call['schema']),stage,report,Path(temp)/str(index))
quality.task_messages=original
report={'schema':'reploid.typed-source-execution-audit/v1','weightsLoaded':False,'realModelRerun':False,
 'scope':'Actual retained evaluator/tokenizers/cache classes with a sentinel forward; proves host forwarding, not full original model internal states.',
 'evaluatorSha256':digest(quality.__file__),'observed':observed,'inputIdsDiffer':calls[0]['inputIds']!=calls[1]['inputIds'],
 'firstStepTopLogitsDiffer':calls[0]['firstStep']['raw']!=calls[1]['firstStep']['raw'],
 'actualFirstToolLogits':[next(x['logit'] for x in c['firstStep']['raw'] if x['text']=='<tool_call>') for c in calls],
 'outputPrefixEqual':calls[1]['tokenIds']==calls[0]['tokenIds'][:len(calls[1]['tokenIds'])],
 'officialCorrectionFramePresent':'<tool_response>\n{"ok": false, "error": "Request count exceeds bounds"}\n</tool_response>' in calls[1]['renderedPrompt'],
 'correctionInstructionPresent':suite['correctionInstruction'] in calls[1]['renderedPrompt'],
 'sourceInspection':{'observedAfterRun':True,'modelingFile':implementation.__file__,'modelingSha256':digest(implementation.__file__),'cacheFile':cache_implementation.__file__,'cacheSha256':digest(cache_implementation.__file__),
 'textForward':'embed_tokens(input_ids); positions span full sequence; causal mask uses full inputs and fresh cache; all hidden rows enter decoder layers.',
 'recurrenceForward':'Prefill with sequence length greater than one does not use precomputed recurrent state; chunk_gated_delta_rule receives initial_state=None.',
 'cacheConstructor':'Each DynamicCache constructs a fresh list of full/linear attention cache layer instances.'},
 'conclusion':'No concrete evaluator forwarding, official tool framing, or stale cache ownership defect established. Distinct actual logits show computations differed, not that every correction token influenced all states.',
 'remainingUncertainty':'Original model attention/recurrent activations at every position were not captured; this audit cannot prove that no deeper implementation defect exists.'}
Path(args.out).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'forwardControls':len(observed),'weightsLoaded':False,'firstStepTopLogitsDiffer':report['firstStepTopLogitsDiffer']}))
