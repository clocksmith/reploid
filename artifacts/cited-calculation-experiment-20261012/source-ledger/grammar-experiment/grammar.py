"""Canonical syntax for the frozen row-tag call; no fact values or expected roles."""
from dataclasses import dataclass
from functools import lru_cache
import json

@dataclass(frozen=True)
class State:
    part: int = 0
    mode: str = 'literal'
    offset: int = 0
    prefix: str = ''
    seen: tuple = ()

class RowGrammar:
    def __init__(self, fact_count, passage_count, fact_tags, passage_tags, fact_max=8, passage_max=5):
        if not all(type(n) is int and 0 <= n <= 40 for n in [fact_count,passage_count]):
            raise ValueError('Bounded row counts required')
        if not all(type(n) is int and 0 <= n <= 8 for n in [fact_max,passage_max]):
            raise ValueError('Bounded tag counts required')
        for tags in [fact_tags,passage_tags]:
            if not tags or any(not isinstance(tag,str) or not tag for tag in tags) or len(set(tags))!=len(tags):
                raise ValueError('Unique nonempty string enums required')
        parts=['<tool_call>\n{"name":"AnnotateSource","arguments":{"factRoles":[']
        for i in range(fact_count):
            if i:parts.append(',')
            parts.append((tuple(fact_tags),fact_max))
        parts.append('],"passageRelations":[')
        for i in range(passage_count):
            if i:parts.append(',')
            parts.append((tuple(passage_tags),passage_max))
        parts.append(']}}\n</tool_call>')
        self.parts=tuple(parts)

    def initial(self):return State()
    def complete(self,state):return state.part==len(self.parts)
    def next_part(self,state):
        index=state.part+1
        return State(index,'literal' if index==len(self.parts) or isinstance(self.parts[index],str) else 'open')

    @lru_cache(maxsize=32768)
    def edges(self,state):
        if self.complete(state):return {}
        part=self.parts[state.part]
        if isinstance(part,str):
            following=self.next_part(state) if state.offset+1==len(part) else State(state.part,'literal',state.offset+1)
            return {part[state.offset]:following}
        tags,maximum=part
        if state.mode=='open':return {'[':State(state.part,'first')}
        if state.mode in ['first','required']:
            result={']':self.next_part(state)} if state.mode=='first' else {}
            if len(state.seen)<maximum and len(state.seen)<len(tags):result['"']=State(state.part,'word',prefix='"',seen=state.seen)
            return result
        if state.mode=='after':
            result={']':self.next_part(state)}
            if len(state.seen)<maximum and len(state.seen)<len(tags):result[',']=State(state.part,'required',seen=state.seen)
            return result
        if state.mode=='word':
            result={}
            for tag in tags:
                if tag in state.seen:continue
                text=json.dumps(tag,ensure_ascii=True,separators=(',',':'))
                if not text.startswith(state.prefix):continue
                at=len(state.prefix);char=text[at];prefix=state.prefix+char
                result[char]=State(state.part,'after',seen=state.seen+(tag,)) if prefix==text else State(state.part,'word',prefix=prefix,seen=state.seen)
            return result
        raise ValueError('Invalid grammar state')

    def advance(self,state,text):
        for char in text:
            state=self.edges(state).get(char)
            if state is None:return None
        return state

class TokenTrie:
    """Walk only vocabulary prefixes admitted by the grammar, not every token per step."""
    def __init__(self, tokens, eos_ids):
        self.root={};self.texts={};self.eos_ids=tuple(eos_ids)
        for token,text in tokens.items():
            if token in self.eos_ids or not text or not text.isascii():continue
            node=self.root
            for char in text:node=node.setdefault(char,{})
            node.setdefault(None,[]).append(token);self.texts[token]=text

    def choices(self,grammar,state):
        if grammar.complete(state):return {token:state for token in self.eos_ids}
        result={};pending=[(self.root,state)]
        while pending:
            node,current=pending.pop()
            for token in node.get(None,[]):result[token]=current
            for char,following in grammar.edges(current).items():
                child=node.get(char)
                if child is not None:pending.append((child,following))
        return result
