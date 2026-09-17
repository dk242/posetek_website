import copy
import unittest
from evals.kick_review_evaluation import athlete_split, evaluate_case, evaluate_dataset

class ReviewEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.review = {'schemaVersion':1,'datasetVersion':'kick-review-v1','playerId':'athlete',
            'reviewId':'r1','targetType':'single','targetId':'rep','split':athlete_split('athlete'),
            'source':{'mode':'agent','jobId':'job','resultHash':'abc'},
            'original':{'metrics':[{'id':'contact.knee'}],'evidence':{'rows':[{'id':'event.speed'}]}},
            'expected':{'focusAreas':[{'rank':1,'evidenceIds':['event.speed']},{'rank':2,'evidenceIds':['contact.knee']}]}}
        self.candidate = {'reviewId':'r1','sourceJobId':'job','result':{'focusAreas':[{'rank':1,'metricIds':['event.speed']},{'rank':2,'metricIds':['contact.knee']}]}}

    def test_all_priorities_retained(self):
        result=evaluate_case(self.review,self.candidate)
        self.assertEqual(result['priorityEvidenceRecall'],1)
        self.assertTrue(result['firstPriorityRetainedFirst'])
        self.assertTrue(result['requiresHumanReview'])

    def test_missing_priority_regresses(self):
        self.candidate['result']['focusAreas'].pop(0)
        result=evaluate_case(self.review,self.candidate)
        self.assertEqual(result['priorityEvidenceRecall'],0.5)
        self.assertFalse(result['passesStructuralChecks'])

    def test_reordering_exposes_top_priority_loss(self):
        for i,row in enumerate(reversed(self.candidate['result']['focusAreas'])): row['rank']=i+1
        self.assertFalse(evaluate_case(self.review,self.candidate)['firstPriorityRetainedFirst'])
        self.assertFalse(evaluate_case(self.review,self.candidate)['passesStructuralChecks'])

    def test_unknown_citation_rejected(self):
        self.candidate['result']['focusAreas'].append({'rank':3,'evidenceIds':['invented']})
        self.assertEqual(evaluate_case(self.review,self.candidate)['unknownEvidenceIds'],['invented'])

    def test_empty_expert_assessment_does_not_require_fault(self):
        self.review['expected']['focusAreas']=[]
        self.assertEqual(evaluate_case(self.review,self.candidate)['unexpectedFocusCount'],2)

    def test_source_mismatch_rejected(self):
        self.candidate['sourceJobId']='different'
        with self.assertRaises(ValueError): evaluate_case(self.review,self.candidate)

    def test_split_mismatch_rejected(self):
        self.review['split']='train' if self.review['split']=='evaluation' else 'evaluation'
        with self.assertRaises(ValueError): evaluate_dataset([self.review],[self.candidate],'all')

    def test_duplicate_target_revisions_rejected(self):
        other=copy.deepcopy(self.review); other['reviewId']='r2'
        with self.assertRaises(ValueError): evaluate_dataset([self.review,other],[self.candidate],'all')

    def test_no_candidates_is_not_pass(self):
        self.assertEqual(evaluate_dataset([self.review],[],'all')['status'],'no_evidence')

    def test_manual_examples_are_retained_but_not_scored_as_agent(self):
        self.review['source']['mode']='manual'
        result=evaluate_dataset([self.review],[],'all')
        self.assertEqual(len(result['skipped']),1)
        self.assertEqual(result['status'],'no_evidence')

    def test_uncited_expert_priorities_cannot_produce_pass(self):
        self.review['expected']['focusAreas']=[{'rank':1,'evidenceIds':[]}]
        result=evaluate_dataset([self.review],[self.candidate],'all')
        self.assertEqual(result['status'],'human_review_required')

    def test_ineligible_citation_cannot_be_scored_as_supported(self):
        self.review['original']['evidence']['rows'][0]['eligible']=False
        result=evaluate_case(self.review,self.candidate)
        self.assertIn('event.speed',result['unknownEvidenceIds'])
        self.assertFalse(result['passesStructuralChecks'])

if __name__ == '__main__': unittest.main()
