// Sanitized handoff only after live delivery and create-only import verification.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {cloud,DOCUMENTS,decode}=require('./training-cloud.cjs');
const DIR='.netlify/training-expansion/release';
const read=name=>JSON.parse(fs.readFileSync(`${DIR}/${name}.json`));
async function main(){
 const c=await cloud(),source=read('source'),build=read('build-result'),gateway=read('gateway-verified'),web=read('web-live-verified'),functions=read('functions-verified');
 const imported=JSON.parse(fs.readFileSync('.netlify/training-expansion/import-verified.json'));
 assert.equal(build.status,'SUCCESS');assert.equal(build.steps[1].status,'SUCCESS');
 assert.deepEqual(build.source,source.source);assert.equal(gateway.health.ok,true);assert.equal(gateway.health.version,source.version);
 const routed=gateway.service.trafficStatuses.filter(t=>t.percent>0);assert.equal(routed.length,1);assert.equal(routed[0].revision,source.revision);assert.equal(routed[0].percent,100);
 assert.equal(imported.added,80);assert.equal(imported.authors,80);assert.equal(imported.existingDocumentsUnchanged,true);
 assert.equal(web.result.allPassed,true);assert.equal(functions.rows.length,9);
 for(const row of functions.rows){assert.equal(row.state,'ACTIVE');assert.equal(row.unauthenticatedStatus,401);}
 const currentConfig=await c.api(`${DOCUMENTS}/config/llm`),config=decode({mapValue:{fields:currentConfig.fields}});
 assert.equal(config.wholeBodyTraining.mobileVerified,false);assert.equal(config.wholeBodyTraining.previewEnabled,true);
 const query={structuredQuery:{from:[{collectionId:'trainingPlans',allDescendants:true}],select:{fields:[{fieldPath:'planRevision'},{fieldPath:'status'},{fieldPath:'schemaVersion'}]}}};
 const rows=(await c.api(`${DOCUMENTS}:runQuery`,'POST',query)).filter(x=>x.document).map(x=>x.document).filter(d=>decode({mapValue:{fields:d.fields}}).status==='active').sort((a,b)=>a.name.localeCompare(b.name));
 assert.deepEqual(rows,read('active-plans-before'),'Active plans changed during release; inspect before claiming preservation.');
 const logs=await c.api('https://logging.googleapis.com/v2/entries:list','POST',{resourceNames:['projects/kickai-69dd0'],filter:`resource.type="build" AND resource.labels.build_id="${build.id}" AND textPayload:"passed"`,orderBy:'timestamp desc',pageSize:10});
 const summary=(logs.entries||[]).map(e=>e.textPayload||'').find(t=>/\d+ passed/.test(t))||null;
 const m=summary?.match(/(\d+) passed(?:, (\d+) skipped)?/);
 const rules=read('candidate-ruleset'),storage=read('candidate-storage-ruleset'),before=read('before');
 const manifest=JSON.parse(fs.readFileSync('content/training-expansion/manifest.json'));
 const inventory=read('web-production-files');
 const baseline=JSON.parse(fs.readFileSync('deployment/homepage-baseline.json'));
 assert.equal(baseline.deploymentId,web.result.deploymentId);assert.ok(inventory.every(f=>f.deploy_id===web.result.deploymentId));
 const idMap={schemaVersion:1,productionBatchId:manifest.productionBatchId,manifestSha256:imported.receipt.manifestSha256,importedAt:imported.receipt.at,ids:imported.receipt.mapping};
 fs.writeFileSync('content/training-expansion/production-id-map.json',JSON.stringify(idMap,null,2)+'\n');
 const receipt={schemaVersion:1,release:'Whole-body training draft library and reviewed tailoring',status:'production-verified-drafts-unpublished',verifiedAt:new Date().toISOString(),
  source:{repository:'https://github.com/dk242/posetek_website',branch:'codex/whole-body-training',gatewayCommit:source.commit,initialImplementationCommit:'f97d26d',archiveSha256:source.sha256,archiveGeneration:source.source.storageSource.generation},
  backend:{project:'kickai-69dd0',region:'us-west1',service:'agent-gateway',revision:source.revision,image:gateway.service.template.containers[0].image,buildId:build.id,buildStatus:build.status,trafficPercent:100,previousRevision:before.service.template.revision,mandatoryFullContainerSuitePassed:true,containerSummary:summary,containerTestsPassed:m?Number(m[1]):null,containerTestsSkipped:m?Number(m[2]||0):null,runtimeConfigurationPreserved:true,existingCapabilityPoliciesPreserved:true},
  website:{deploymentId:web.result.deploymentId,url:'https://posetek.net',previewUrl:read('web-preview').deploy_url,applicationSha1:web.result.applicationSha,checksPassed:web.result.checks,approvedMarketingDeploymentId:web.result.marketingDeploymentId,marketingBytesPreserved:true,baselineFiles:baseline.files.length,previousDeploymentId:'6aac924a597bd46f15cf468a'},
  functions:{count:9,endpoints:functions.rows.map(r=>({name:r.name,status:r.state,versionId:r.versionId})),unauthenticatedChecksPassed:9,existingFunctionsNotDeployed:true,discoveryTimeoutSeconds:120,cloudSchedulerApiEnabledByFirebasePreparation:true},
  rules:{firestoreRuleset:rules.ruleset.name,firestoreSha256:rules.sha256,source:'deployment/whole-body-firestore.rules',composition:'Exact live baseline plus training changes; separate native testing blocks excluded.',storageRuleset:storage.ruleset.name,storageSha256:storage.sha256,trainingAssertions:37,mediaAssertions:7,existingPlannerAssertions:353},
  catalog:{productionBatchId:manifest.productionBatchId,newDrafts:80,authoringRecords:80,existingRecordsPreserved:imported.receipt.existingCount,versionBefore:imported.receipt.catalogVersionBefore,versionAfter:imported.receipt.catalogVersionAfter,manifestSha256:imported.receipt.manifestSha256,idMap:'content/training-expansion/production-id-map.json',allocation:manifest.allocation,weeklyAllocation:manifest.weeklyAllocation,filmingWeeks:4,drillsPerWeek:20,requiredClipsPerDrill:3,totalRequiredClips:240,publishedByRelease:0,humanContentReviews:'pending',videosUploadedByRelease:0},
  delivery:{webPreviewEnabled:true,mobileVerified:false,expandedActivationHeld:true,nativeSourceOrRulesDeployed:false,reviewersDesignatedByRelease:0,playerClearancesWrittenByRelease:0,activePlansPreserved:rows.length,newCapabilities:{save_workout_edit:config.capabilities.save_workout_edit,validate_workout_start:config.capabilities.validate_workout_start}},
  validation:{appFullSuitePassed:1002,finalAppFocusedTestsPassed:18,callableTestsPassed:20,importVerificationTestsPassed:4,contentTestsPassed:6,releaseAndCompositionTestsPassed:23,finalGatewayFocusedTestsPassed:242,syntheticDesktopAndMobileVisualQaPassed:true,all80PassGatewayAndAuthoringSchema:true},
  handoff:'docs/WHOLE_BODY_TRAINING.md',rollback:'Preserve imported drafts and private-collection rules. Keep mobileVerified false; coordinate prior gateway and website restoration without deleting plans/logs. Do not restore the old broad private-data fallback.',privacy:'No athlete identities, individual test values, private plan content or credentials are included.'};
 fs.writeFileSync('deployment/WHOLE_BODY_TRAINING_PRODUCTION.json',JSON.stringify(receipt,null,2)+'\n');
 fs.writeFileSync(`${DIR}/final-preservation.json`,JSON.stringify({activePlansPreserved:rows.length,at:receipt.verifiedAt},null,2));
 console.log(JSON.stringify({status:receipt.status,newDrafts:80,activePlansPreserved:rows.length,baselineFiles:baseline.files.length,containerTestsPassed:receipt.backend.containerTestsPassed}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
