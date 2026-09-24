// Operator-only tooling. Uses the existing CLI login; never logs/persists tokens.
const path = require('node:path');
const PROJECT = 'kickai-69dd0';
const DOCUMENTS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
function decode(v) {
  if (v?.mapValue) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k,x]) => [k,decode(x)]));
  if (v?.arrayValue) return (v.arrayValue.values || []).map(decode);
  if (v?.integerValue !== undefined) return Number(v.integerValue);
  return v?.stringValue ?? v?.doubleValue ?? v?.booleanValue ?? v?.timestampValue ?? null;
}
function encode(v) {
  if (v === null) return {nullValue:null};
  if (Array.isArray(v)) return {arrayValue:{values:v.map(encode)}};
  if (typeof v === 'object') return {mapValue:{fields:Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).map(([k,x])=>[k,encode(x)]))}};
  if (typeof v === 'number') return Number.isInteger(v) ? {integerValue:String(v)} : {doubleValue:v};
  if (typeof v === 'boolean') return {booleanValue:v};
  return {stringValue:String(v)};
}
async function cloud() {
  const cli = process.env.FIREBASE_TOOLS_ROOT || path.join(process.env.APPDATA || '', 'npm/node_modules/firebase-tools');
  const auth = require(path.join(cli,'lib/auth.js'));
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw Error('An existing operator Firebase CLI login is required.');
  const credentials = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  async function request(url, options={}) {
    return fetch(url,{...options,headers:{Authorization:`Bearer ${credentials.access_token}`,...options.headers}});
  }
  async function api(url, method='GET', body) {
    const response=await request(url,{method,headers:{'Content-Type':'application/json'},...(body === undefined ? {} : {body:JSON.stringify(body)})});
    const data=await response.json();
    if (!response.ok) throw Error(`${method} ${new URL(url).pathname}: ${response.status} ${data.error?.message || 'request failed'}`);
    return data;
  }
  async function list(collection) {
    let token, documents=[];
    do {
      const page=await api(`${DOCUMENTS}/${collection}?pageSize=1000${token?'&pageToken='+encodeURIComponent(token):''}`);
      documents.push(...(page.documents||[])); token=page.nextPageToken;
    } while(token);
    return documents;
  }
  return {api,list,request};
}
module.exports={PROJECT,DOCUMENTS,decode,encode,cloud};
