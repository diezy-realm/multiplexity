const {test}=require('node:test');const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');const os=require('node:os');const path=require('node:path');
const {developmentEnvironment}=require('../../scripts/local-web.cjs');
test('local web keeps stable isolated keys and does not inherit desktop identity',()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'multiplexity-web-env-'));
 try{
  const input={MANAGER_DEV_DATA_PATH:directory,PORT:'3300',DESKTOP_MODE:'1',DATABASE_PATH:'do-not-use.db',ENCRYPTION_KEY:'do-not-use'};
  const first=developmentEnvironment(input);const second=developmentEnvironment(input);
  assert.equal(first.ENCRYPTION_KEY===second.ENCRYPTION_KEY,true);assert.equal(first.NEXTAUTH_SECRET===second.NEXTAUTH_SECRET,true);
  assert.equal(first.ENCRYPTION_KEY==='do-not-use',false);assert.equal(first.DESKTOP_MODE,'0');assert.equal(first.MANAGER_LOCAL_DEV,'1');
  assert.equal(first.DATABASE_PATH,path.join(directory,'dashboard.db'));assert.equal(first.NEXTAUTH_URL,'http://localhost:3300');
  assert.throws(()=>developmentEnvironment({...input,PORT:'not-a-port'}),/PORT/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
