from pathlib import Path
import copy,hashlib,json,sys
root=Path(__file__).resolve().parent;sys.path.insert(0,str(root.parent))
from contract import INSTRUCTION,bind_occurrence,messages
question='Compare these fictional workshop quotes for my $6,200 budget. Explain prices, exclusions and conditions, citing source IDs.'
rows=[
 ('F1:P1','The quoted workshop refit price is $6,430, including installation.','$6,430','quoted_total','The occurrence states the offered refit price, with installation included.'),
 ('F2:P1','Workstations cost $137 each; delivery is excluded.','$137','unit_price','The explicit each qualifier defines one workstation, not total requested quantity.'),
 ('F3:P1','Add a mandatory $286 delivery charge to the quoted work price.','$286','additional_charge','The separate charge is explicit and mandatory in this passage.'),
 ('F4:P1','If the inspection identifies water damage, an additional $713 repair fee applies.','$713','additional_charge','The extra charge is conditional. Classification must not establish that damage was found or add it unconditionally.'),
 ('F5:P1','The quoted price already includes a $368 allowance for wiring.','$368','included_allowance','Already includes states that this amount is covered, not added.'),
 ('F6:P1','We received your $924 payment; this credit reduces the remaining balance.','$924','prior_payment','Received and credit explicitly describe an existing payment, not a future deposit.'),
 ('F7:P1','The advance deposit is 18% of $5,270.','$5,270','deposit_basis','The occurrence is only the percentage basis, not the deposit payable or a separately introduced quote.'),
 ('F8:P1','Deposit due on acceptance: 32% of $7,360.','$7,360','deposit_basis','This is the explicit deposit calculation basis despite the different wording.'),
 ('F9:P1','The form lists $482 beside an unlabeled reference field; its purpose is not specified.','$482','unknown','The passage does not state a supported role; no default may be inferred.')]
old=json.loads((root.parent/'suite.json').read_text());suite=copy.deepcopy(old)
suite.update(scope='Fresh matched context/no-context local price classification only; no complete answer or model qualification.',cases=[])
fixture={'schema':'reploid.price-context-ablation-input/v1','globalQuestion':question,'selection':'All nine fresh occurrences, source order, control then treatment; no case selection by output.','originalDocumentCases':str(root.parent.parent/'row-tag-experiment/suite.json'),'pairs':[]}
review=[]
for index,(source,passage,value,expected,reason) in enumerate(rows):
 occurrence=bind_occurrence(source,passage,value);pair={'sourceOccurrence':occurrence,'arms':[]}
 for arm,context in [('control',[question]),('without_global_question',[])]:
  msg=messages(context,occurrence);ident=f'fresh-{index+1}-{arm}';pair['arms'].append({'id':ident,'messages':msg})
  suite['cases'].append({'id':ident,'messages':msg[1:],'reviewCriteria':['Independent exact local relation review, all original full-task gates unchanged; no automatic semantic pass.']})
 fixture['pairs'].append(pair);review.append({'sourceOccurrence':occurrence,'requiredRelation':expected,'reason':reason})
(root/'input.json').write_text(json.dumps(fixture,indent=2)+'\n');(root/'suite.json').write_text(json.dumps(suite,indent=2)+'\n')
(root/'review-criteria.json').write_text(json.dumps({'schema':'reploid.price-context-ablation-review/v1','sourceModelReadsThisFile':False,'rows':review,'allRowsRequired':True,'noPosthocSubset':True,'interpretation':'Compare all nine matched labels. A treatment local pass requires9/9 including unknown and conditional cost limits. Even9/9 establishes only this local role task; original full factual/citation/correction tests and two locked holdouts remain required. No calculation or final answer runs in this diagnostic.'},indent=2)+'\n')
