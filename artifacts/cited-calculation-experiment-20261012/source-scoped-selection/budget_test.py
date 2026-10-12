from budget import allowance
limits={'generatedTokens':4096,'promptPlusGeneratedTokens':8192,'rawOutputUtf16':16000,'extractionMaxTokens':1536}
row={'promptTokens':0,'generatedTokens':0,'rawOutputUtf16':0}
assert allowance(limits,row,1200,3)==512
row.update(promptTokens=5000,generatedTokens=1000)
assert allowance(limits,row,2000)==192
assert allowance(limits,row,2200)==0
row.update(promptTokens=1000,generatedTokens=4000)
assert allowance(limits,row,1000)==96
row['rawOutputUtf16']=16000
assert allowance(limits,row,0)==0
print('aggregate repeated prompt, generation, source split and UTF16 admission passed')
