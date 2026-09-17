import contextlib
from copy import deepcopy
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import prepare as release

class FakeApi:
    def __init__(self):
        self.rows = {release.PARENT + '/functions/unrelated': {'name': 'unrelated', 'versionId': '7'}}
        self.archives = {}
        self.policies = {}
    def inventory(self): return deepcopy(self.rows)
    def source(self, endpoint, version): return self.archives[endpoint]
    def iam(self, endpoint): return deepcopy(self.policies.get(endpoint, {'bindings': [], 'etag': 'fixture'}))
    def deployed(self, run, extra=None):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            for path in (run / 'source').iterdir(): archive.writestr(path.name, path.read_bytes())
            if extra: archive.writestr(extra, 'unexpected')
        for name in release.ENDPOINTS:
            definition = release.expected_definitions()[name]
            row = {'name': release.PARENT + '/functions/' + name, 'status': 'ACTIVE', 'entryPoint': name, 'runtime': 'nodejs22', 'versionId': '1',
                   **{k: deepcopy(definition[k]) for k in ('timeout', 'availableMemoryMb', 'maxInstances')}}
            if name in release.CALLABLES:
                row.update({'httpsTrigger': {'url': f'https://{release.REGION}-{release.PROJECT}.cloudfunctions.net/{name}'},
                            'labels': {'deployment-callable': 'true'}, 'ingressSettings': 'ALLOW_ALL'})
                self.policies[name] = {'etag': 'fixture', 'bindings': [{'role': 'roles/cloudfunctions.invoker', 'members': ['allUsers']}]}
            else: row['eventTrigger'] = deepcopy(definition['eventTrigger'])
            self.rows[release.PARENT + '/functions/' + name] = row
            self.archives[name] = data.getvalue()

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp_parent = release.ROOT / '.netlify' / 'expanded-insights-release-tests'
        self.temp_parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=self.temp_parent)
        self.assertTrue(Path(self.temp.name).resolve().is_relative_to(self.temp_parent.resolve()))
        self.run = Path(self.temp.name) / 'run'
        self.api = FakeApi()
        with contextlib.redirect_stdout(io.StringIO()): release.prepare(self.run, self.api)
    def tearDown(self): self.temp.cleanup()
    def test_exact_source_and_unrelated_inventory(self):
        self.api.deployed(self.run)
        with contextlib.redirect_stdout(io.StringIO()): release.verify(self.run, self.api)
        self.assertTrue(json.loads((self.run / 'verified.json').read_text())['unrelatedFunctionsPreserved'])
        self.assertEqual(len(list((self.run / 'source').iterdir())), 11)
    def test_refuses_local_source_drift(self):
        self.api.deployed(self.run)
        (self.run / 'source' / 'index.js').write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'Prepared source changed'): release.verify(self.run, self.api)
    def test_refuses_unrelated_function_change(self):
        self.api.deployed(self.run)
        self.api.rows[release.PARENT + '/functions/unrelated'] = {'versionId': '8'}
        with self.assertRaisesRegex(RuntimeError, 'Unrelated'): release.verify(self.run, self.api)
    def test_refuses_unexpected_published_file(self):
        self.api.deployed(self.run, 'private.json')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected file'): release.verify(self.run, self.api)
    def test_refuses_source_mismatch(self):
        self.api.deployed(self.run)
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            for path in (self.run / 'source').iterdir(): archive.writestr(path.name, b'wrong' if path.name == 'index.js' else path.read_bytes())
        self.api.archives[release.ENDPOINTS[0]] = data.getvalue()
        with self.assertRaisesRegex(RuntimeError, 'Deployed source differs'): release.verify(self.run, self.api)
    def test_refuses_existing_run(self):
        with self.assertRaisesRegex(RuntimeError, 'fresh run'): release.prepare(self.run, self.api)
    def test_pinned_definitions_match_observed_sdk_contract(self):
        definitions = release.expected_definitions()
        self.assertEqual(definitions['recordInsightUsage']['availableMemoryMb'], 256)
        self.assertEqual(definitions['projectInsightRecords']['eventTrigger'], {
            'resource': 'projects/kickai-69dd0/databases/(default)/documents/players/{playerId}/{collectionId}/{recordId}',
            'eventType': 'providers/cloud.firestore/eventTypes/document.write', 'service': 'firestore.googleapis.com', 'failurePolicy': {'retry': {}}})
        self.assertEqual(definitions['projectInsightArtifactDeletes']['eventTrigger']['eventType'], 'google.storage.object.delete')
    def test_refuses_each_runtime_limit_drift(self):
        for field, value, message in [('timeout', '60s', 'Timeout'), ('availableMemoryMb', 256, 'Memory'), ('maxInstances', 100, 'Maximum instances')]:
            with self.subTest(field=field):
                self.api.deployed(self.run)
                self.api.rows[release.PARENT + '/functions/getClubInsightsV2'][field] = value
                with self.assertRaisesRegex(RuntimeError, message): release.verify(self.run, self.api)
    def test_refuses_each_event_contract_drift(self):
        for field, value in [('resource', 'projects/other/buckets/other'), ('eventType', 'google.storage.object.delete'),
                             ('service', 'pubsub.googleapis.com'), ('failurePolicy', {})]:
            with self.subTest(field=field):
                self.api.deployed(self.run)
                self.api.rows[release.PARENT + '/functions/projectInsightArtifacts']['eventTrigger'][field] = value
                with self.assertRaisesRegex(RuntimeError, 'Event trigger'): release.verify(self.run, self.api)
    def test_refuses_missing_or_conditional_public_invoker(self):
        for binding in [None, {'role': 'roles/cloudfunctions.invoker', 'members': ['allAuthenticatedUsers']},
                        {'role': 'roles/cloudfunctions.invoker', 'members': ['allUsers'], 'condition': {'expression': 'false'}}]:
            with self.subTest(binding=binding):
                self.api.deployed(self.run)
                self.api.policies['getClubInsightsV2'] = {'bindings': [] if binding is None else [binding]}
                with self.assertRaisesRegex(RuntimeError, 'public invoker IAM'): release.verify(self.run, self.api)
    def test_refuses_wrong_trigger_kind_label_url_or_ingress(self):
        for patch in [{'httpsTrigger': None}, {'labels': {}}, {'httpsTrigger': {'url': 'https://other.test'}}, {'ingressSettings': 'ALLOW_INTERNAL_ONLY'}]:
            with self.subTest(patch=patch):
                self.api.deployed(self.run)
                self.api.rows[release.PARENT + '/functions/getClubInsightsV2'].update(patch)
                with self.assertRaisesRegex(RuntimeError, 'Callable'): release.verify(self.run, self.api)
    def test_prepare_captures_existing_configuration_iam_and_archive(self):
        self.api.deployed(self.run)
        old_iam = deepcopy(self.api.policies['getClubInsightsV2'])
        other = Path(self.temp.name) / 'with-existing'
        with contextlib.redirect_stdout(io.StringIO()): release.prepare(other, self.api)
        manifest = release.read(other / 'manifest.json')
        self.assertEqual(release.read(other / 'before-iam.json')['getClubInsightsV2'], old_iam)
        self.assertEqual(manifest['rollback']['getClubInsightsV2']['sha256'], release.sha((other / 'getClubInsightsV2-before.zip').read_bytes()))
        self.assertEqual(manifest['rollback']['getClubInsightsV2']['configurationSha256'], release.sha(json.dumps(self.api.rows[release.PARENT + '/functions/getClubInsightsV2'], sort_keys=True).encode()))
    def test_refuses_concurrent_deployment_during_verification(self):
        self.api.deployed(self.run)
        source = self.api.source
        def changed(endpoint, version):
            self.api.rows[release.PARENT + '/functions/getClubInsightsV2']['versionId'] = '2'
            return source(endpoint, version)
        self.api.source = changed
        with self.assertRaisesRegex(RuntimeError, 'changed during verification'): release.verify(self.run, self.api)
    def test_refuses_concurrent_iam_change_during_verification(self):
        self.api.deployed(self.run)
        source = self.api.source
        def changed(endpoint, version):
            if endpoint == 'getClubInsightsV2': self.api.policies[endpoint]['etag'] = 'changed'
            return source(endpoint, version)
        self.api.source = changed
        with self.assertRaisesRegex(RuntimeError, 'IAM changed during verification'): release.verify(self.run, self.api)
    def test_refuses_stale_definition_or_configuration_manifest(self):
        self.api.deployed(self.run)
        manifest = release.read(self.run / 'manifest.json')
        manifest['definitions']['recordInsightUsage']['maxInstances'] = 999
        release.write(self.run / 'manifest.json', manifest)
        with self.assertRaisesRegex(RuntimeError, 'expected definitions changed'): release.verify(self.run, self.api)
    def test_accepts_semantic_duration_and_documented_default_memory(self):
        self.api.deployed(self.run)
        self.api.rows[release.PARENT + '/functions/getClubInsightsV2']['timeout'] = '540.000s'
        self.api.rows[release.PARENT + '/functions/recordInsightUsage'].pop('availableMemoryMb')
        with contextlib.redirect_stdout(io.StringIO()): release.verify(self.run, self.api)

if __name__ == '__main__': unittest.main()
