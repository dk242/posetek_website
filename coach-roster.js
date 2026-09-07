(function(){
  "use strict";
  const config={apiKey:"AIzaSyBSfyXyhmD4kYGRSg-jOmGeLeOO8hX0-Gs",authDomain:"kickai-69dd0.firebaseapp.com",projectId:"kickai-69dd0",storageBucket:"kickai-69dd0.firebasestorage.app",messagingSenderId:"839600313930",appId:"1:839600313930:web:13b1e94c2c540561e3f8b3"};
  if(!firebase.apps.length)firebase.initializeApp(config);
  const auth=firebase.auth(),db=firebase.firestore();
  const grid=document.getElementById("playersGrid"),summary=document.getElementById("rosterSummary"),orgName=document.getElementById("organizationName"),searchWrap=document.getElementById("searchWrap"),search=document.getElementById("playerSearch"),dialog=document.getElementById("addPlayerDialog"),message=document.getElementById("formMessage");
  let coachDoc=null,players=[],pendingRosterPlayer=null;
  const escape=value=>String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
  const initials=player=>`${player.firstName?.[0]||""}${player.lastName?.[0]||""}`.toUpperCase()||"A";
  const fullName=player=>[player.firstName,player.lastName].filter(Boolean).join(" ")||player.name||"Athlete";
  function makeCode(){const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let result="PLR";for(let i=0;i<4;i++)result+=chars[Math.floor(Math.random()*chars.length)];return result;}
  async function findCoach(uid){return PoseTekIdentity.findCoach(db,uid);}
  function render(){const needle=search.value.trim().toLowerCase();const shown=players.filter(player=>fullName(player).toLowerCase().includes(needle)||(player.code||"").toLowerCase().includes(needle));const pending=players.filter(player=>!(player.registered===true||player.userUID)).length;summary.textContent=`${players.length} ${players.length===1?"player":"players"} · ${pending} awaiting signup`;searchWrap.hidden=players.length<=6;if(!shown.length){grid.innerHTML=`<div class="empty-card"><span class="material-symbols-outlined">group_add</span><h3>${players.length?"No matching athletes":"No players yet"}</h3><p>${players.length?"Try another name or player code.":"Add the first athlete to begin collecting results."}</p></div>`;return;}grid.innerHTML=shown.map(player=>{const registered=player.registered===true||Boolean(player.userUID);return `<button class="roster-player" type="button" data-player="${escape(player.id)}"><span class="player-avatar">${escape(initials(player))}</span><span class="player-copy"><strong>${escape(fullName(player))}</strong><span class="player-meta"><span class="status-chip ${registered?"active":"pending"}">${registered?"Active":"Invite pending"}</span>${registered?"":`<span>Code ${escape(player.signupCode||player.code||"—")}</span>`}</span></span><span class="player-chevron material-symbols-outlined">chevron_right</span></button>`}).join("");const preview=new URLSearchParams(location.search).get("preview")==="1";grid.querySelectorAll("[data-player]").forEach(button=>button.addEventListener("click",()=>location.href=`profile.html?${preview?"preview=1&":""}player=${encodeURIComponent(button.dataset.player)}&userType=coach`));}
  async function loadRoster(){grid.innerHTML='<div class="portal-loading"><span class="spinner"></span><p>Loading your roster…</p></div>';const user=auth.currentUser;if(!user)return;coachDoc=await findCoach(user.uid);if(!coachDoc)throw new Error("No coach profile is linked to this sign-in.");const coach=coachDoc.data()||{};if(coach.org?.get){try{const org=await coach.org.get();orgName.textContent=org.exists?(org.data().name||"Coach dashboard"):"Independent coach";}catch(_){orgName.textContent="Coach dashboard";}}else orgName.textContent="Independent coach";const ids=[...new Set(Array.isArray(coach.members)?coach.members:[])];const docs=await Promise.all(ids.map(id=>db.collection("players").doc(id).get()));players=docs.filter(doc=>doc.exists).map(doc=>({id:doc.id,...doc.data()})).sort((a,b)=>fullName(a).localeCompare(fullName(b)));render();}
  function setMessage(text,success=false){message.textContent=text;message.classList.toggle("success",success);}
  async function createPlayer(){
    const user=auth.currentUser;
    if(!user||!coachDoc||coachDoc.data().userUID!==user.uid)return setMessage("Please sign in again with your coach account.");
    const firstInput=document.getElementById("newFirstName"),lastInput=document.getElementById("newLastName"),button=document.getElementById("createPlayerButton");
    const firstName=firstInput.value.trim(),lastName=lastInput.value.trim();
    if(pendingRosterPlayer&&(pendingRosterPlayer.uid!==user.uid||pendingRosterPlayer.coachId!==coachDoc.id))return setMessage("Return to the coach account that created the pending player to finish its roster link.");
    if(!pendingRosterPlayer&&(!firstName||!lastName))return setMessage("Enter both a first and last name.");
    button.disabled=true;
    setMessage(pendingRosterPlayer?"Retrying roster link…":"Creating player…",true);
    try{
      if(!pendingRosterPlayer){
        const playerRef=db.collection("players").doc();
        await playerRef.set({firstName,lastName,coachUID:user.uid,coachDocId:coachDoc.id,registered:false,signupCode:makeCode(),signupCodeVersion:2,createdAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
        pendingRosterPlayer={id:playerRef.id,uid:user.uid,coachId:coachDoc.id};
      }
      const pending=pendingRosterPlayer;
      if(auth.currentUser?.uid!==user.uid)throw new Error("The signed-in account changed. Sign back in to finish the roster link.");
      // The player exists before membership changes. A transaction makes a
      // repeated link idempotent, including a retry after a lost acknowledgement.
      await db.runTransaction(async transaction=>{
        const snapshot=await transaction.get(coachDoc.ref);
        const coach=snapshot.data()||{};
        if(!snapshot.exists||coach.userUID!==user.uid)throw new Error("The coach profile could not be verified.");
        const members=Array.isArray(coach.members)?coach.members:[];
        if(!members.includes(pending.id))transaction.update(coachDoc.ref,{members:[...members,pending.id],numberMembers:members.length+1});
      });
      pendingRosterPlayer=null;
      firstInput.value="";
      lastInput.value="";
      dialog.close();
      await loadRoster();
    }catch(error){
      setMessage(pendingRosterPlayer?"Player created, but the roster link could not be saved. Keep this page open and tap Retry Roster Link.":error.message||"The player could not be created.");
    }finally{
      button.disabled=false;
      button.textContent=pendingRosterPlayer?"Retry Roster Link":"Create Player";
      firstInput.disabled=Boolean(pendingRosterPlayer);
      lastInput.disabled=Boolean(pendingRosterPlayer);
    }
  }
  // Roster attachment by code runs in the admission service: the coach never
  // queries other athletes' profiles, and only post-lockdown codes are accepted.
  async function addExisting(){
    const user=auth.currentUser;
    const code=document.getElementById("existingPlayerCode").value.trim().toUpperCase();
    if(!code)return setMessage("Enter the player's code.");
    if(!user||!coachDoc||coachDoc.data().userUID!==user.uid)return setMessage("Please sign in again with your coach account.");
    const button=document.getElementById("addExistingButton");
    button.disabled=true;
    setMessage("Adding player…",true);
    try{
      await firebase.functions().httpsCallable("attachPlayerByCode")({code});
      document.getElementById("existingPlayerCode").value="";
      dialog.close();
      await loadRoster();
    }catch(error){
      setMessage(error.message||"The player could not be added.");
    }finally{
      button.disabled=false;
    }
  }
  document.getElementById("signOutButton").addEventListener("click",async()=>{await auth.signOut();location.href="kickai.html";});document.getElementById("refreshButton").addEventListener("click",()=>loadRoster().catch(showError));document.getElementById("addPlayerButton").addEventListener("click",()=>{setMessage(pendingRosterPlayer?"A created player needs its roster link saved. Tap Retry Roster Link.":"");dialog.showModal();});search.addEventListener("input",render);document.querySelectorAll("[data-add-tab]").forEach(tab=>tab.addEventListener("click",()=>{document.querySelectorAll("[data-add-tab]").forEach(item=>item.classList.toggle("active",item===tab));document.querySelectorAll("[data-add-panel]").forEach(panel=>panel.hidden=panel.dataset.addPanel!==tab.dataset.addTab);setMessage(pendingRosterPlayer?"A created player needs its roster link saved. Tap Retry Roster Link.":"");}));document.getElementById("createPlayerButton").addEventListener("click",createPlayer);document.getElementById("addExistingButton").addEventListener("click",addExisting);
  function showError(error){console.error("[roster]",error);grid.innerHTML=`<div class="error-card"><span class="material-symbols-outlined">error</span><h3>Roster unavailable</h3><p>${escape(error.message||"Please refresh and try again.")}</p></div>`;}
  if(new URLSearchParams(location.search).get("preview")==="1"){orgName.textContent="Vacaville Training";players=[{id:"preview-player",firstName:"Jordan",lastName:"Rivera",registered:true,userUID:"preview-auth"},{id:"preview-2",firstName:"Maya",lastName:"Thompson",registered:false,signupCode:"PLR7K9Q"},{id:"preview-3",firstName:"Eli",lastName:"Santos",registered:true,userUID:"preview-auth-2"},{id:"preview-4",firstName:"Avery",lastName:"Chen",registered:false,signupCode:"PLR4M8T"}];render();}else auth.onAuthStateChanged(user=>{if(!user){location.replace("kickai.html");return;}loadRoster().catch(showError);});
})();
