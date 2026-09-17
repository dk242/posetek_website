import hashlib,json
from gateway.storage import ArtifactStore
from tests.test_storage import _FakeBlob,_FakeBucket


def test_private_context_routing_keeps_old_contexts_and_pose_artifacts_readable(monkeypatch):
    monkeypatch.setenv('TRAINING_CONTEXT_BUCKET','private-contexts')
    old='trainingPlanContexts/player/old/hash.json'
    new='trainingPlanContexts/player/new/hash.json'
    buckets={'uploads':_FakeBucket({old:_FakeBlob(b'{"old":true}'),'pose.json':_FakeBlob(b'{"pose":true}')}),
             'private-contexts':_FakeBucket({new:_FakeBlob(b'{"new":true}'),'pose.json':_FakeBlob(b'{"wrong":true}')})}
    class Client:
        def bucket(self,name):return buckets[name]
    store=ArtifactStore(Client(),'uploads')
    assert store.download_json(old)=={'old':True}
    assert store.download_json(new)=={'new':True}
    assert store.download_json('pose.json')=={'pose':True}


def test_immutable_upload_uses_only_the_configured_private_bucket(monkeypatch):
    monkeypatch.setenv('TRAINING_CONTEXT_BUCKET','private-contexts')
    writes=[]
    class Blob:
        def upload_from_string(self,raw,**kwargs):writes.append((raw,kwargs))
    class Bucket:
        def blob(self,path):return Blob()
    class Client:
        def bucket(self,name):
            assert name=='private-contexts'
            return Bucket()
    value={'test':True};raw=json.dumps(value,sort_keys=True,separators=(',',':')).encode()
    ArtifactStore(Client(),'uploads').upload_immutable_json('trainingPlanContexts/player/plan/'+hashlib.sha256(raw).hexdigest()+'.json',value)
    assert writes[0][1]['if_generation_match']==0
