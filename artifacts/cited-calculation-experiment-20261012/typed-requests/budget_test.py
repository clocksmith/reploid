import unittest
from budget import typed_allowance, correction_allowed
L={'generatedTokens':4096,'promptPlusGeneratedTokens':8192,'rawOutputUtf16':16000,'extractionMaxTokens':1536}
class BudgetTests(unittest.TestCase):
    def test_correction_shares_source(self):
        row={'promptTokens':1120,'generatedTokens':200,'rawOutputUtf16':500}
        self.assertEqual(typed_allowance(L,row,1500,3,200),312)
        self.assertEqual(typed_allowance(L,row,1500,3,512),0)
        self.assertTrue(correction_allowed(0,'eos',True,True,312))
        for args in [(1,'eos',True,True,312),(0,'max-tokens',True,True,312),(0,'eos',False,True,312),(0,'eos',True,False,312),(0,'eos',True,True,0)]:
            self.assertFalse(correction_allowed(*args))
    def test_repeated_prompt_admission(self):
        row={'promptTokens':6200,'generatedTokens':500,'rawOutputUtf16':900}
        self.assertEqual(typed_allowance(L,row,1450,3,200),42)
        self.assertEqual(typed_allowance(L,row,1492,3,200),0)
        self.assertEqual(typed_allowance(L,{**row,'rawOutputUtf16':16000},1),0)
if __name__=='__main__':unittest.main()
