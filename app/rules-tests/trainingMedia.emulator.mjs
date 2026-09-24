import { firestoreEmulator, storageEmulator } from './canonicalRules.mjs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, deleteObject } from 'firebase/storage';
const env=await initializeTestEnvironment({projectId:'demo-personalized-planner',firestore:firestoreEmulator(),storage:storageEmulator()});
const admin=env.authenticatedContext('admin',{email:'reviewer@posetek.net',email_verified:true}),athlete=env.authenticatedContext('athlete',{email:'athlete@example.test',email_verified:true});
const seed=status=>env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'drillCatalog/STR-999'),{productionBatchId:'whole-body-2026-09',status}));
const path='drillCatalogMedia/app/STR-999/primaryDemo.unique-1.mp4';
const upload=(ctx,p=path)=>uploadBytes(ref(ctx.storage(),p),new Uint8Array([1,2,3]),{contentType:'video/mp4'});
try{
 await seed('draft');
 await assertFails(upload(athlete));
 await assertSucceeds(upload(admin));
 await assertFails(upload(admin));
 await assertSucceeds(upload(admin,'drillCatalogMedia/app/STR-999/primaryDemo.unique-2.mp4'));
 await seed('published');
 await assertFails(upload(admin,'drillCatalogMedia/app/STR-999/primaryDemo.unique-3.mp4'));
 await assertFails(deleteObject(ref(admin.storage(),path)));
 await seed('archived');await assertSucceeds(deleteObject(ref(admin.storage(),path)));
 console.log('Training media: 7 assertions passed.');
}finally{await env.cleanup();}
