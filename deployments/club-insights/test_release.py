"""Offline release tests: fake APIs and synthetic configuration; no credentials."""
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('insights_release', HERE/'release.py')
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)


def archive(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as z:
        for name, content in files.items(): z.writestr(name, content)
    return output.getvalue()


class FakeApi:
    def __init__(self, existing=False):
        donor = {'name': r.PARENT+'/functions/getTeamLeaderboard', 'entryPoint': 'getTeamLeaderboard',
                 'runtime': 'nodejs22', 'status': 'ACTIVE', 'environment': 'GEN_1', 'timeout': '60s',
                 'availableMemoryMb': 256, 'serviceAccountEmail': 'synthetic-runtime', 'versionId': '1',
                 'environmentVariables': {'GCLOUD_PROJECT': 'synthetic', 'FUNCTION_TARGET': 'getTeamLeaderboard'},
                 'httpsTrigger': {'securityLevel': 'SECURE_ALWAYS', 'url': 'https://example.invalid/donor'},
                 'labels': {'existing': 'preserve'}}
        self.records = {donor['name']: donor}
        if existing:
            target = copy.deepcopy(donor); target.update(name=r.NAME, entryPoint=r.ENDPOINT, timeout='120s')
            self.records[r.NAME] = target
        self.policy = {'etag': 'synthetic-etag', 'bindings': [{'role': 'roles/cloudfunctions.invoker', 'members': ['allUsers']}]}
        self.old = archive({'index.js': 'original scoped source', 'package.json': '{}'})
        self.sources = {'1': self.old}; self.uploads = {}; self.mutations = []; self.count = 1
        self.done = True; self.uncertain = False
    def inventory(self): return copy.deepcopy(self.records)
    def get(self): return copy.deepcopy(self.records.get(r.NAME))
    def iam(self): return copy.deepcopy(self.policy)
    def upload(self, data):
        key = 'https://storage.googleapis.com/synthetic/'+str(len(self.uploads)); self.uploads[key] = data
        self.mutations.append(('upload', None)); return key
    def download(self, version): return self.sources[str(version)]
    def change(self, body, create=False):
        assert body['name'] == r.NAME
        self.mutations.append(('create' if create else 'patch', body['name']))
        self.count += 1
        row = copy.deepcopy(body if create else self.records[r.NAME]); row.update(copy.deepcopy(body))
        row.update(status='ACTIVE', versionId=str(self.count), updateTime='synthetic-'+str(self.count))
        row.setdefault('environment', 'GEN_1'); row['httpsTrigger'].setdefault('url', 'https://example.invalid/callable')
        self.records[r.NAME] = row; self.sources[str(self.count)] = self.uploads[body['sourceUploadUrl']]
        if create: self.policy = {'etag': 'created-etag', 'bindings': []}
        if self.uncertain: raise r.ReleaseError('Uncertain response')
        return {'name': 'operations/synthetic-'+str(self.count)}
    def operation(self, name): return {'done': self.done}
    def set_public(self, policy):
        assert policy['etag'] == self.policy['etag']
        self.mutations.append(('iam', r.NAME)); self.policy['bindings'].append({'role': 'roles/cloudfunctions.invoker', 'members': ['allUsers']})
    def delete(self): self.mutations.append(('delete', r.NAME)); self.records.pop(r.NAME); return {'name': 'operations/delete'}


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name); self.run = self.base/'private-release'
        self.bundle = archive({name: '{}\n' if name.endswith('.json') else '// synthetic\n' for name in r.FILES})
        self.files = r.zip_manifest(self.bundle)
        self.bundle_patch = patch.object(r, 'source_bundle', return_value=(self.bundle, self.files)); self.bundle_patch.start(); self.addCleanup(self.bundle_patch.stop)
    def prepare(self, existing=False):
        api = FakeApi(existing); r.dry_run(api, self.run)
        evidence = r.read(self.run/'evidence-template.json'); evidence['checks'] = {k: True for k in r.CHECKS}
        r.write(self.run/'evidence.json', evidence); return api
    def test_dry_run_makes_no_remote_mutations_and_only_six_files(self):
        api = FakeApi(); result = r.dry_run(api, self.run)
        self.assertEqual(api.mutations, []); self.assertEqual(result['action'], 'create'); self.assertEqual(set(result['sourceFiles']), set(r.FILES))
    def test_create_verify_repeat_and_rollback_preserve_unrelated(self):
        api = self.prepare(); before = api.inventory()
        self.assertEqual(r.deploy(api, self.run)['status'], 'deployed')
        self.assertEqual(r.verify(api, self.run)['status'], 'verified')
        count = len(api.mutations); r.deploy(api, self.run); self.assertEqual(len(api.mutations), count)
        self.assertEqual(r.rollback(api, self.run)['status'], 'rolled-back')
        count = len(api.mutations); r.rollback(api, self.run); self.assertEqual(len(api.mutations), count)
        self.assertEqual(api.inventory(), before)
        self.assertTrue(all(target in (None, r.NAME) for _, target in api.mutations))
    def test_existing_update_and_rollback_restore_exact_source_runtime_and_iam(self):
        api = self.prepare(True); original = api.get(); policy = api.iam()
        r.deploy(api, self.run); r.verify(api, self.run); r.rollback(api, self.run)
        self.assertEqual(r.stable(api.get()), r.stable(original)); self.assertEqual(api.iam(), policy)
        self.assertEqual(api.download(api.get()['versionId']), api.old)
        self.assertFalse(any(op in ('create', 'delete', 'iam') for op, _ in api.mutations))
    def test_evidence_cannot_be_omitted_or_reused_for_other_source(self):
        api = self.prepare(); evidence = r.read(self.run/'evidence.json'); evidence['sourceSha256'] = 'other'
        r.write(self.run/'evidence.json', evidence, replace=True)
        with self.assertRaises(r.ReleaseError): r.deploy(api, self.run)
        self.assertEqual(api.mutations, [])
    def test_source_tampering_fails_before_upload(self):
        api = self.prepare(); (self.run/'source.zip').write_bytes(b'changed')
        with self.assertRaises(r.ReleaseError): r.deploy(api, self.run)
        self.assertEqual(api.mutations, [])
    def test_plan_cannot_widen_scope_even_with_recomputed_hash(self):
        api = self.prepare(); plan = r.read(self.run/'plan.json'); plan['name'] = r.PARENT+'/functions/other'
        plan['planHash'] = r.digest({k:v for k,v in plan.items() if k != 'planHash'}); r.write(self.run/'plan.json',plan,replace=True)
        with self.assertRaises(r.ReleaseError): r.deploy(api,self.run)
        self.assertEqual(api.mutations, [])
    def test_drift_aborts_before_any_upload(self):
        api = self.prepare(); api.records[next(iter(api.records))]['timeout'] = '90s'
        with self.assertRaises(r.ReleaseError): r.deploy(api,self.run)
        self.assertEqual(api.mutations, [])
    def test_queued_operation_resumes_without_redeploy(self):
        api = self.prepare(); api.done = False
        self.assertEqual(r.deploy(api,self.run)['status'],'deploying'); count=len(api.mutations)
        self.assertEqual(r.deploy(api,self.run)['status'],'deploying'); self.assertEqual(len(api.mutations),count)
        api.done=True; self.assertEqual(r.deploy(api,self.run)['status'],'deployed')
        self.assertEqual(sum(op=='create' for op,_ in api.mutations),1)
    def test_uncertain_mutation_never_retries_blindly(self):
        api=self.prepare(); api.uncertain=True
        with self.assertRaises(r.ReleaseError): r.deploy(api,self.run)
        count=len(api.mutations)
        with self.assertRaises(r.ReleaseError): r.deploy(api,self.run)
        self.assertEqual(len(api.mutations),count)
    def test_rollback_refuses_a_newer_version(self):
        api=self.prepare(); r.deploy(api,self.run); api.records[r.NAME]['versionId']='newer'
        count=len(api.mutations)
        with self.assertRaises(r.ReleaseError): r.rollback(api,self.run)
        self.assertEqual(len(api.mutations),count)
    def test_verify_detects_different_deployed_source(self):
        api=self.prepare(); r.deploy(api,self.run); api.sources[api.get()['versionId']]=archive({'index.js':'wrong'})
        with self.assertRaises(r.ReleaseError): r.verify(api,self.run)
    def test_wrong_source_not_adopted_or_made_public_after_operation(self):
        api=self.prepare(); api.done=False; r.deploy(api,self.run)
        api.sources[api.get()['versionId']]=archive({'index.js':'intervening source'})
        api.done=True; count=len(api.mutations)
        with self.assertRaises(r.ReleaseError): r.deploy(api,self.run)
        self.assertEqual(len(api.mutations),count)
        self.assertFalse(r.public(api.iam()))
        self.assertEqual(r.read(self.run/'journal.json')['status'],'deploying')
    def test_operation_version_is_not_silently_replaced(self):
        api=self.prepare(); api.done=False; r.deploy(api,self.run)
        api.operation=lambda name:{'done':True,'response':{'name':r.NAME,'versionId':'older'}}
        with self.assertRaises(r.ReleaseError): r.deploy(api,self.run)
        self.assertFalse(r.public(api.iam()))
    def test_repeat_rollback_rechecks_absence(self):
        api=self.prepare(); r.deploy(api,self.run); deployed=api.get(); r.rollback(api,self.run); api.records[r.NAME]=deployed
        with self.assertRaises(r.ReleaseError): r.rollback(api,self.run)
    def test_archive_path_traversal_rejected(self):
        with self.assertRaises(r.ReleaseError): r.zip_manifest(archive({'../private.txt':'bad'}))
    def test_auth_never_attached_to_signed_source_upload(self):
        api=r.GoogleApi(self.base/'nonexistent.json')
        class Response:
            def __enter__(self): return self
            def __exit__(self,*_): pass
            def read(self,*_): return b''
        with patch.object(r,'urlopen',return_value=Response()) as call:
            api.request('PUT','https://storage.googleapis.com/synthetic',body=b'zip',signed=True,binary=True)
        headers=dict(call.call_args.args[0].header_items()); self.assertNotIn('Authorization',headers)
        self.assertEqual(headers.get('Content-type'),'application/zip')
    def test_signed_source_host_restricted(self):
        with self.assertRaises(r.ReleaseError): r.GoogleApi('unused').request('GET','https://example.invalid/source',signed=True)
    def test_real_source_dependency_closure_is_complete(self):
        self.bundle_patch.stop()
        bundle, files=r.source_bundle(); self.assertEqual(set(r.zip_manifest(bundle)),set(files)); self.assertEqual(set(files),set(r.FILES))


if __name__=='__main__': unittest.main()
