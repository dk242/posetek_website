from pathlib import Path
from urllib.request import urlretrieve
from concurrent.futures import ThreadPoolExecutor
import hashlib
base=Path(__file__).parent / 'models'
root='https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/'
expected={
 'kokoro-v1.0.onnx':'beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a',
 'voices-v1.0.bin':'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d',
}
def download(name):
    p=base/name
    if not p.exists():
        print('Downloading', name, flush=True)
        base.mkdir(parents=True,exist_ok=True)
        pending=base/(name+'.partial')
        urlretrieve(root+name,pending)
        if hashlib.sha256(pending.read_bytes()).hexdigest()!=expected[name]:
            raise RuntimeError('Model checksum mismatch: '+name)
        pending.replace(p)
    if hashlib.sha256(p.read_bytes()).hexdigest()!=expected[name]:
        raise RuntimeError('Existing model checksum mismatch: '+name)
    print(name,p.stat().st_size,flush=True)
with ThreadPoolExecutor(max_workers=2) as pool:
    list(pool.map(download,['kokoro-v1.0.onnx','voices-v1.0.bin']))
