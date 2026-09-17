#!/usr/bin/env python3
"""Release only getClubInsights. No hosting, rules, database, or other function writes."""
from __future__ import annotations
import argparse
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
import zipfile

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
PROJECT, REGION, ENDPOINT = 'kickai-69dd0', 'us-central1', 'getClubInsights'
PARENT = f'projects/{PROJECT}/locations/{REGION}'
NAME = f'{PARENT}/functions/{ENDPOINT}'
API = 'https://cloudfunctions.googleapis.com/v1/'
SOURCE_LABEL, RELEASE_LABEL = 'posetek-insights-source', 'posetek-insights-release'
FILES = ('index.js', 'club-insights.js', 'club-access.js', 'athlete-storage-paths.js', 'package.json', 'package-lock.json')
CHECKS = ('handlerTests', 'scopedEntrypointTests', 'releaseToolTests')
TRANSIENT = {'status', 'updateTime', 'versionId', 'buildId', 'buildName', 'sourceUploadUrl', 'sourceArchiveUrl', 'sourceRepository', 'buildServiceAccount'}
CREATE_FIELDS = ('availableMemoryMb', 'serviceAccountEmail', 'environmentVariables', 'buildEnvironmentVariables',
                 'minInstances', 'maxInstances', 'ingressSettings')
MAX_ZIP = 100 * 1024 * 1024


class ReleaseError(Exception): pass
def require(condition, message):
    if not condition: raise ReleaseError(message)
def sha(data): return hashlib.sha256(data).hexdigest()
def canonical(data): return json.dumps(data, sort_keys=True, separators=(',', ':')).encode()
def digest(data): return sha(canonical(data))
def read(path): return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def timestamp(): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
def linked(path): return path.is_symlink() or getattr(path, 'is_junction', lambda: False)()


def write(path, value, *, replace=False):
    path = Path(path)
    require(not linked(path), 'Private file cannot be a symlink or junction')
    require(replace or not path.exists(), 'Receipt already exists; inspect it before retrying')
    temporary = path.with_name(path.name + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2); stream.write('\n')
    os.replace(temporary, path)


def private_path(path):
    path = Path(path).absolute()
    try: relative = path.relative_to(ROOT)
    except ValueError: raise ReleaseError('Private artifacts must remain inside the repository')
    require(relative.parts and '..' not in relative.parts, 'Invalid private artifact path')
    for parent in (path, *path.parents):
        if parent == ROOT: break
        require(not linked(parent), 'Private artifacts cannot traverse symlinks or junctions')
    ignored = subprocess.run(['git', 'check-ignore', '--quiet', '--', str(relative)], cwd=ROOT, capture_output=True)
    require(ignored.returncode == 0, 'Private artifacts and credentials must be ignored by Git')
    return path


class GoogleApi:
    def __init__(self, credential_file): self.credential_file = Path(credential_file)
    def token(self):
        record = read(self.credential_file)
        require(isinstance(record.get('expires_at'), (int, float)) and record['expires_at'] > time.time()*1000 + 60000,
                'Owner session needs renewal')
        require(isinstance(record.get('access_token'), str) and record['access_token'], 'Owner access token is absent')
        return record['access_token']
    def request(self, method, url, *, body=None, signed=False, binary=False, missing=False):
        parsed = urlparse(url)
        require(parsed.scheme == 'https', 'Only HTTPS API URLs are allowed')
        if signed:
            require(parsed.hostname == 'storage.googleapis.com' or parsed.hostname.endswith('.storage.googleapis.com'),
                    'Unexpected signed source URL host')
            headers = {}
        else:
            require(parsed.hostname == 'cloudfunctions.googleapis.com', 'Unexpected API host')
            headers = {'Authorization': 'Bearer ' + self.token()}
        if isinstance(body, bytes):
            headers.update({'Content-Type': 'application/zip', 'x-goog-content-length-range': '0,104857600'})
        elif body is not None:
            headers['Content-Type'] = 'application/json'; body = canonical(body)
        try:
            with urlopen(Request(url, data=body, headers=headers, method=method), timeout=90) as response:
                data = response.read(MAX_ZIP + 1)
                require(len(data) <= MAX_ZIP, 'Source response exceeds the archive limit')
                return data if binary else (json.loads(data) if data else {})
        except HTTPError as error:
            if missing and error.code == 404: return None
            raise ReleaseError(f'Google API {method} failed (HTTP {error.code}); private response was not logged') from None
        except (URLError, TimeoutError):
            raise ReleaseError('Google API result is uncertain; inspect the journal before retrying') from None
    def inventory(self):
        result, token = {}, None
        while True:
            query = '?' + urlencode({'pageToken': token}) if token else ''
            response = self.request('GET', API + PARENT + '/functions' + query)
            for row in response.get('functions', []): result[row['name']] = row
            token = response.get('nextPageToken')
            if not token: return result
    def get(self): return self.request('GET', API + NAME, missing=True)
    def iam(self): return self.request('GET', API + NAME + ':getIamPolicy')
    def download(self, version):
        response = self.request('POST', API + NAME + ':generateDownloadUrl', body={'versionId': str(version)})
        return self.request('GET', response['downloadUrl'], signed=True, binary=True)
    def upload(self, data):
        response = self.request('POST', API + PARENT + '/functions:generateUploadUrl', body={})
        self.request('PUT', response['uploadUrl'], body=data, signed=True, binary=True)
        return response['uploadUrl']
    def operation(self, name):
        require(name.startswith('operations/') or name.startswith(PARENT + '/operations/'), 'Unexpected operation name')
        return self.request('GET', API + name)
    def change(self, body, *, create=False):
        require(body.get('name') == NAME, 'Mutation target is outside getClubInsights')
        return self.request('POST' if create else 'PATCH', API + PARENT + '/functions' if create else
                            API + NAME + '?updateMask=sourceUploadUrl,labels,timeout', body=body)
    def set_public(self, policy):
        require(bool(policy.get('etag')), 'IAM compare-and-swap etag is absent')
        result = copy.deepcopy(policy)
        binding = next((b for b in result.setdefault('bindings', []) if b.get('role') == 'roles/cloudfunctions.invoker' and not b.get('condition')), None)
        if binding is None:
            binding = {'role': 'roles/cloudfunctions.invoker', 'members': []}; result['bindings'].append(binding)
        if 'allUsers' not in binding['members']: binding['members'].append('allUsers')
        return self.request('POST', API + NAME + ':setIamPolicy', body={'policy': result})
    def delete(self): return self.request('DELETE', API + NAME)


def public(policy):
    return any(b.get('role') == 'roles/cloudfunctions.invoker' and not b.get('condition') and
               'allUsers' in b.get('members', []) for b in policy.get('bindings', []))


def validate_runtime(row):
    require(row.get('status') == 'ACTIVE' and row.get('runtime') == 'nodejs22' and row.get('environment', 'GEN_1') == 'GEN_1'
            and row.get('httpsTrigger'), 'Expected an active gen1 Node 22 HTTP function')
    require(not any(row.get(key) for key in ('vpcConnector', 'secretVolumes', 'secretEnvironmentVariables', 'kmsKeyName', 'dockerRepository')),
            'Review custom network, secret, encryption or repository settings separately')
    require(row.get('ingressSettings', 'ALLOW_ALL') == 'ALLOW_ALL' and row['httpsTrigger'].get('securityLevel', 'SECURE_ALWAYS') == 'SECURE_ALWAYS',
            'Expected the existing public HTTPS callable transport')


def source_bundle(source=ROOT/'functions', wrapper=HERE/'index.js'):
    source = Path(source)
    originals = {name: (Path(wrapper) if name == 'index.js' else source/name) for name in FILES}
    for path in originals.values():
        require(path.is_file() and not any(linked(parent) for parent in (path, *path.parents)), 'Required source file missing or unsafe')
    data = {name: path.read_bytes() for name, path in originals.items()}
    main = (source/'index.js').read_text(encoding='utf-8')
    narrow = data['index.js'].decode('utf-8').replace('\r\n', '\n')
    caller = re.compile(r'^function requireCaller\(context\) \{.*?^\}', re.M | re.S)
    require(caller.search(main) and caller.search(narrow) and caller.search(main).group() == caller.search(narrow).group(),
            'Scoped caller authentication differs from functions/index.js')
    export = 'exports.getClubInsights = functions.runWith({ timeoutSeconds: 120 }).https.onCall((data, context) => clubInsights.getClubInsights(data, requireCaller(context)));'
    require(export in main and export in narrow and re.findall(r'exports\.([A-Za-z0-9_]+)\s*=', narrow) == [ENDPOINT],
            'Scoped callable export differs from the reviewed website source')
    package, lock = json.loads(data['package.json']), json.loads(data['package-lock.json'])
    require(package.get('engines', {}).get('node') == '22' and package.get('main', 'index.js') == 'index.js', 'Unexpected package entrypoint/runtime')
    require(lock.get('packages', {}).get('', {}).get('dependencies') == package.get('dependencies'), 'Package lock root dependencies differ')
    for name, content in data.items():
        if not name.endswith('.js'): continue
        text = content.decode('utf-8')
        calls = re.findall(r'require\(([^)]*)\)', text)
        for expression in calls:
            match = re.fullmatch(r'[\'"]([^\'"]+)[\'"]', expression.strip())
            require(match is not None, 'Dynamic source dependencies require release-tool review')
            dependency = match.group(1)
            require((dependency.startswith('./') and dependency[2:] + '.js' in data) or
                    dependency in ('firebase-functions', 'firebase-admin', 'crypto', 'node:crypto'), 'Unreviewed source dependency')
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            info = zipfile.ZipInfo(name, (2026, 9, 17, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED; info.external_attr = 0o644 << 16
            archive.writestr(info, data[name])
    return output.getvalue(), {name: {'sha256': sha(value), 'bytes': len(value)} for name, value in data.items()}


def zip_manifest(data):
    require(len(data) <= MAX_ZIP, 'Source ZIP exceeds limit')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            files = [item for item in archive.infolist() if not item.is_dir()]
            require(sum(item.file_size for item in files) <= 500*1024*1024, 'Expanded source exceeds limit')
            require(len({item.filename for item in files}) == len(files), 'Duplicate archive filenames')
            require(all(not item.filename.startswith(('/', '\\')) and '..' not in item.filename.replace('\\', '/').split('/') for item in files), 'Unsafe source archive paths')
            return {item.filename: {'sha256': sha(archive.read(item)), 'bytes': item.file_size} for item in files}
    except zipfile.BadZipFile: raise ReleaseError('Source response is not a ZIP') from None


def stable(row): return {k: v for k, v in row.items() if k not in TRANSIENT}
def journal_write(run, journal): write(run/'journal.json', journal, replace=True)


def dry_run(api, run, source=ROOT/'functions', wrapper=HERE/'index.js'):
    run = Path(run); require(not run.exists(), 'Use a new private release directory')
    bundle, files = source_bundle(source, wrapper)
    records = api.inventory(); target = records.get(NAME)
    donor = target or records.get(PARENT + '/functions/getTeamLeaderboard')
    require(donor is not None, 'Expected callable runtime donor is missing'); validate_runtime(donor)
    if target: require(target.get('entryPoint') == ENDPOINT, 'Target entrypoint differs')
    policy = api.iam() if target else None
    if target: require(public(policy), 'Existing callable IAM needs separate review')
    rollback = api.download(target['versionId']) if target else None
    rollback_files = zip_manifest(rollback) if rollback else None
    require(api.inventory() == records, 'Function inventory changed during snapshot')
    run.mkdir(parents=True, mode=0o700)
    (run/'source.zip').write_bytes(bundle); (run/'source.zip').chmod(0o600)
    if rollback: (run/'rollback.zip').write_bytes(rollback); (run/'rollback.zip').chmod(0o600)
    before = {'functions': records, 'iam': policy, 'donor': donor, 'capturedAt': timestamp()}
    plan = {'schemaVersion': 1, 'name': NAME, 'project': PROJECT, 'region': REGION, 'action': 'update' if target else 'create',
            'sourceSha256': sha(bundle), 'files': files, 'baselineHash': digest(before), 'beforeVersion': target.get('versionId') if target else None,
            'rollbackSha256': sha(rollback) if rollback else None, 'rollbackFiles': rollback_files, 'requiredChecks': list(CHECKS), 'createdAt': timestamp()}
    plan['planHash'] = digest(plan)
    write(run/'before.json', before); write(run/'plan.json', plan)
    write(run/'evidence-template.json', {'planHash': plan['planHash'], 'sourceSha256': plan['sourceSha256'], 'checks': {key: False for key in CHECKS}})
    return {'status': 'dry-run', 'action': plan['action'], 'endpoint': ENDPOINT, 'planHash': plan['planHash'], 'sourceSha256': plan['sourceSha256'], 'sourceFiles': list(FILES), 'remoteMutations': 0}


def load_release(run, *, evidence=False):
    run = Path(run); plan, before = read(run/'plan.json'), read(run/'before.json')
    require(plan.get('planHash') == digest({k: v for k, v in plan.items() if k != 'planHash'}), 'Plan integrity changed')
    require(plan.get('name') == NAME and plan.get('project') == PROJECT and plan.get('region') == REGION and
            plan.get('action') in ('create', 'update') and plan.get('requiredChecks') == list(CHECKS), 'Release scope changed')
    require(plan['baselineHash'] == digest(before), 'Before-image integrity changed')
    bundle = (run/'source.zip').read_bytes()
    require(sha(bundle) == plan['sourceSha256'] and zip_manifest(bundle) == plan['files'] and set(plan['files']) == set(FILES), 'Prepared source changed')
    if plan['action'] == 'update':
        archive = (run/'rollback.zip').read_bytes()
        require(sha(archive) == plan['rollbackSha256'] and zip_manifest(archive) == plan['rollbackFiles'], 'Rollback source changed')
    if evidence:
        proof = read(run/'evidence.json')
        require(proof.get('planHash') == plan['planHash'] and proof.get('sourceSha256') == plan['sourceSha256'] and
                all(proof.get('checks', {}).get(key) is True for key in CHECKS), 'Validation evidence is missing or belongs to another source')
    return plan, before, bundle


def desired_body(plan, before, upload):
    target = before['functions'].get(NAME)
    labels = copy.deepcopy(target.get('labels', {}) if target else {'deployment-callable': 'true'})
    labels.update({SOURCE_LABEL: plan['sourceSha256'][:32], RELEASE_LABEL: plan['planHash'][:32]})
    body = {'name': NAME, 'sourceUploadUrl': upload, 'labels': labels, 'timeout': '120s'}
    if not target:
        donor = before['donor']
        body.update({k: copy.deepcopy(donor[k]) for k in CREATE_FIELDS if k in donor})
        body.update(entryPoint=ENDPOINT, runtime='nodejs22', httpsTrigger={'securityLevel': 'SECURE_ALWAYS'})
        for key in ('EVENTARC_CLOUD_EVENT_SOURCE', 'FUNCTION_TARGET'):
            if key in body.get('environmentVariables', {}): body['environmentVariables'][key] = NAME if key == 'EVENTARC_CLOUD_EVENT_SOURCE' else ENDPOINT
    return body


def matches_release(row, plan, before):
    require(row is not None, 'Released callable is missing'); validate_runtime(row)
    require(row.get('name') == NAME and row.get('entryPoint') == ENDPOINT and row.get('timeout') == '120s', 'Runtime identity or timeout changed')
    expected = desired_body(plan, before, '')
    require(row.get('labels') == expected['labels'], 'Source ownership labels differ')
    target = before['functions'].get(NAME)
    if target:
        allowed = copy.deepcopy(target); allowed['labels'] = expected['labels']; allowed['timeout'] = '120s'
        require(stable(row) == stable(allowed), 'Existing runtime configuration changed')
    else:
        for key in CREATE_FIELDS:
            require(row.get(key) == expected.get(key), 'Created runtime differs from the reviewed donor')


def unrelated_unchanged(records, before):
    require({k: v for k, v in records.items() if k != NAME} == {k: v for k, v in before['functions'].items() if k != NAME}, 'Unrelated function inventory changed; investigate concurrent changes')


def finish_deploy(api, run, plan, before, journal):
    operation = api.operation(journal['operation'])
    if not operation.get('done'): return {'status': 'deploying', 'operation': journal['operation'], 'endpoint': ENDPOINT}
    require(not operation.get('error'), 'Function operation failed; inspect private receipt')
    row = api.get(); matches_release(row, plan, before)
    response = operation.get('response') or {}
    if response.get('name'): require(response['name'] == NAME, 'Operation returned a different function')
    if response.get('versionId'): require(str(response['versionId']) == str(row['versionId']), 'A newer function version intervened after the operation')
    require(zip_manifest(api.download(row['versionId'])) == plan['files'], 'Operation completed with unexpected source contents')
    require(api.get() == row, 'Function changed during source verification')
    policy = api.iam()
    if plan['action'] == 'create' and not public(policy):
        journal['iamIntent'] = digest(policy); journal_write(run, journal)
        api.set_public(policy); policy = api.iam()
    require(public(policy), 'Callable invoker binding is missing')
    if plan['action'] == 'update': require(policy == before['iam'], 'Existing IAM policy changed')
    journal.update(status='deployed', versionId=row['versionId'], deployed=row, iam=policy, completedAt=timestamp())
    journal_write(run, journal)
    return {'status': 'deployed', 'endpoint': ENDPOINT, 'versionId': row['versionId'], 'verificationPending': True}


def deploy(api, run):
    run = Path(run); plan, before, bundle = load_release(run, evidence=True)
    if (run/'journal.json').exists():
        journal = read(run/'journal.json'); require(journal.get('planHash') == plan['planHash'], 'Journal scope changed')
        if journal.get('status') == 'deployed': return verify(api, run)
        require(journal.get('status') == 'deploying' and journal.get('operation'), 'Unconfirmed attempt; inspect live state, never blindly resubmit')
        return finish_deploy(api, run, plan, before, journal)
    require(api.inventory() == before['functions'], 'Live baseline changed; take a new snapshot')
    if plan['action'] == 'update': require(api.iam() == before['iam'], 'Live IAM baseline changed')
    journal = {'planHash': plan['planHash'], 'status': 'uploading', 'startedAt': timestamp()}; journal_write(run, journal)
    upload = api.upload(bundle)
    require(api.inventory() == before['functions'], 'Live baseline changed during upload')
    body = desired_body(plan, before, upload)
    journal.update(status='mutation-intent', request=body); journal_write(run, journal)
    operation = api.change(body, create=plan['action'] == 'create')
    journal.update(status='deploying', operation=operation['name']); journal_write(run, journal)
    return finish_deploy(api, run, plan, before, journal)


def verify(api, run):
    run = Path(run); plan, before, _ = load_release(run)
    journal = read(run/'journal.json'); require(journal.get('planHash') == plan['planHash'] and journal.get('status') == 'deployed', 'A confirmed deployment journal is required')
    row = api.get(); matches_release(row, plan, before)
    require(row.get('versionId') == journal.get('versionId'), 'A newer function version intervened')
    require(api.iam() == journal['iam'], 'Callable IAM changed after deployment')
    downloaded = api.download(row['versionId']); require(zip_manifest(downloaded) == plan['files'], 'Deployed source contents differ')
    unrelated_unchanged(api.inventory(), before)
    result = {'status': 'verified', 'endpoint': ENDPOINT, 'versionId': row['versionId'], 'planHash': plan['planHash'],
              'sourceSha256': plan['sourceSha256'], 'downloadedSourceSha256': sha(downloaded), 'runtimeAndIamPreserved': True,
              'unrelatedFunctionsPreserved': True, 'verifiedAt': timestamp()}
    write(run/'verified.json', result, replace=(run/'verified.json').exists())
    return result


def rollback(api, run):
    run = Path(run); plan, before, _ = load_release(run)
    journal = read(run/'journal.json'); require(journal.get('planHash') == plan['planHash'] and journal.get('status') == 'deployed', 'A confirmed deployment is required for rollback')
    rb_path = run/'rollback-journal.json'
    if rb_path.exists():
        rollback_journal = read(rb_path)
        require(rollback_journal.get('planHash') == plan['planHash'], 'Rollback journal scope changed')
        require(rollback_journal.get('operation'), 'Unconfirmed rollback; inspect live state before retrying')
    else:
        row = api.get(); matches_release(row, plan, before)
        require(row.get('versionId') == journal['versionId'] and api.iam() == journal['iam'], 'Newer version or IAM change prevents rollback')
        unrelated_unchanged(api.inventory(), before)
        rollback_journal = {'planHash': plan['planHash'], 'status': 'rollback-intent', 'startedAt': timestamp()}
        write(rb_path, rollback_journal)
        if plan['action'] == 'create': operation = api.delete()
        else:
            upload = api.upload((run/'rollback.zip').read_bytes())
            require(api.get() == row and api.iam() == journal['iam'], 'Function changed during rollback upload')
            old = before['functions'][NAME]
            operation = api.change({'name': NAME, 'sourceUploadUrl': upload, 'labels': old.get('labels', {}), 'timeout': old.get('timeout', '60s')})
        rollback_journal.update(status='rolling-back', operation=operation['name']); write(rb_path, rollback_journal, replace=True)
    operation = api.operation(rollback_journal['operation'])
    if not operation.get('done'): return {'status': 'rolling-back', 'endpoint': ENDPOINT, 'operation': rollback_journal['operation']}
    require(not operation.get('error'), 'Rollback operation failed; inspect the private receipt')
    row = api.get()
    if plan['action'] == 'create': require(row is None, 'Created callable still exists after rollback')
    else:
        require(row and row.get('status') == 'ACTIVE' and stable(row) == stable(before['functions'][NAME]), 'Restored runtime differs')
        require(api.iam() == before['iam'] and zip_manifest(api.download(row['versionId'])) == plan['rollbackFiles'], 'Restored IAM/source differs')
    unrelated_unchanged(api.inventory(), before)
    rollback_journal.update(status='rolled-back', completedAt=timestamp()); write(rb_path, rollback_journal, replace=True)
    return {'status': 'rolled-back', 'endpoint': ENDPOINT, 'athleteDataWrites': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('dry-run', 'deploy', 'verify', 'rollback'), default='dry-run')
    parser.add_argument('--run-dir', required=True); parser.add_argument('--credential-file', required=True)
    args = parser.parse_args(); run = private_path(args.run_dir); credential = private_path(args.credential_file)
    require(credential.is_file() and not linked(credential), 'Private owner credential file is missing')
    result = {'dry-run': dry_run, 'deploy': deploy, 'verify': verify, 'rollback': rollback}[args.mode](GoogleApi(credential), run)
    print(json.dumps(result))


if __name__ == '__main__':
    try: main()
    except ReleaseError as error: print(str(error), file=sys.stderr); raise SystemExit(1)
    except (OSError, ValueError, KeyError, TypeError):
        print('Release stopped; inspect private inputs and journal. No raw response was logged.', file=sys.stderr); raise SystemExit(1)
