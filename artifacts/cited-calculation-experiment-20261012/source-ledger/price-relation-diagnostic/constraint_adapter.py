"""Reuse the reviewed tokenizer/evaluator mask, changing only the finite output grammar."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'grammar-experiment'))
from constraint import SyntaxConstraint,install_evaluator
from contract import RelationGrammar

class PriceConstraint(SyntaxConstraint):
 def arm(self,unused=None):
  self.grammar=RelationGrammar()
  self.state=self.grammar.initial();self.generated=[];self.previous={};self.enabled=True
