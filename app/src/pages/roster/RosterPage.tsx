/* eslint-disable @typescript-eslint/no-explicit-any */
// Port of coachesview.html + coach-roster.js (coach roster page).
// Behavior parity: same Firestore collections/fields/batches, same dialog flow,
// same preview mode (?preview=1), same copy and class names.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import firebase, { auth, db } from "../../lib/firebase";
import {
  filterPlayers,
  fullName,
  initials,
  isRegistered,
  makeCode,
  sortByName,
  summaryText,
} from "./rosterLogic";
import "../../styles/pose-portal.css";

// Legacy findCoach(uid): direct doc id first, then userUID lookup.
async function findCoach(uid: string) {
  const direct = await db.collection("coaches").doc(uid).get();
  if (direct.exists) return direct;
  const query = await db.collection("coaches").where("userUID", "==", uid).limit(1).get();
  return query.empty ? null : query.docs[0];
}

// Legacy preview roster (unsorted, rendered in this order).
const PREVIEW_PLAYERS: any[] = [
  { id: "preview-player", firstName: "Jordan", lastName: "Rivera", registered: true, userUID: "preview-auth" },
  { id: "preview-2", firstName: "Maya", lastName: "Thompson", registered: false, signupCode: "PLR7K9Q" },
  { id: "preview-3", firstName: "Eli", lastName: "Santos", registered: true, userUID: "preview-auth-2" },
  { id: "preview-4", firstName: "Avery", lastName: "Chen", registered: false, signupCode: "PLR4M8T" },
];

type GridMode = { kind: "loading" } | { kind: "list" } | { kind: "error"; message: string };

export default function RosterPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [players, setPlayers] = useState<any[]>([]);
  // Legacy summary/search visibility only change once render() has run.
  const [rendered, setRendered] = useState(false);
  const [gridMode, setGridMode] = useState<GridMode>({ kind: "loading" });
  const [orgLabel, setOrgLabel] = useState("Coach dashboard");
  const [searchTerm, setSearchTerm] = useState("");
  const [addTab, setAddTab] = useState<"new" | "existing">("new");
  const [formMessage, setFormMessage] = useState({ text: "", success: false });
  const [createBusy, setCreateBusy] = useState(false);
  const [addBusy, setAddBusy] = useState(false);

  const coachDocRef = useRef<any>(null);
  // Sign-out also fires onAuthStateChanged(null); legacy sent both redirects to
  // the same bare URL (kickai.html). Guard so we land on plain /signin, not
  // /signin?returnTo=… captured mid-sign-out.
  const signingOutRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const setMessage = useCallback((text: string, success = false) => {
    setFormMessage({ text, success });
  }, []);

  const loadRoster = useCallback(async () => {
    setGridMode({ kind: "loading" });
    const user = auth.currentUser;
    if (!user) return;
    const coachDoc = await findCoach(user.uid);
    if (!coachDoc) throw new Error("No coach profile is linked to this sign-in.");
    coachDocRef.current = coachDoc;
    const coach = coachDoc.data() || {};
    if (coach.org?.get) {
      try {
        const org = await coach.org.get();
        setOrgLabel(org.exists ? org.data().name || "Coach dashboard" : "Independent coach");
      } catch {
        setOrgLabel("Coach dashboard");
      }
    } else setOrgLabel("Independent coach");
    const ids = [...new Set(Array.isArray(coach.members) ? coach.members : [])];
    const docs = await Promise.all(ids.map((id: any) => db.collection("players").doc(id).get()));
    const loaded = sortByName(
      docs.filter(doc => doc.exists).map(doc => ({ id: doc.id, ...doc.data() })),
    );
    setPlayers(loaded);
    setRendered(true);
    setGridMode({ kind: "list" });
  }, []);

  const showError = useCallback((error: any) => {
    console.error("[roster]", error);
    setGridMode({ kind: "error", message: error.message || "Please refresh and try again." });
  }, []);

  useEffect(() => {
    document.title = "Roster | PoseTek";
    if (new URLSearchParams(window.location.search).get("preview") === "1") {
      setOrgLabel("Vacaville Training");
      setPlayers([...PREVIEW_PLAYERS]);
      setRendered(true);
      setGridMode({ kind: "list" });
      return;
    }
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (!user) {
        if (signingOutRef.current) return;
        navigate(
          `/signin?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`,
          { replace: true },
        );
        return;
      }
      loadRoster().catch(showError);
    });
    return unsubscribe;
    // Boot once, like the legacy script tag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSignOut() {
    signingOutRef.current = true;
    await auth.signOut();
    navigate("/signin"); // legacy: location.href = "kickai.html"
  }

  function openDialog() {
    setMessage("");
    dialogRef.current?.showModal();
  }

  function switchTab(tab: "new" | "existing") {
    setAddTab(tab);
    setMessage("");
  }

  function handleSearch(value: string) {
    setSearchTerm(value);
    // Legacy input listener calls render(), which overwrites whatever the grid held.
    setRendered(true);
    setGridMode({ kind: "list" });
  }

  function openPlayer(id: string) {
    const preview = new URLSearchParams(location.search).get("preview") === "1";
    // legacy: profile.html?{preview=1&}player=<id>&userType=coach
    navigate(`/athlete?${preview ? "preview=1&" : ""}player=${encodeURIComponent(id)}&userType=coach`);
  }

  async function createPlayer() {
    const firstName = firstNameRef.current?.value.trim() ?? "";
    const lastName = lastNameRef.current?.value.trim() ?? "";
    if (!firstName || !lastName) return setMessage("Enter both a first and last name.");
    setCreateBusy(true);
    setMessage("Creating player…", true);
    try {
      const coachDoc = coachDocRef.current;
      const coach = coachDoc.data() || {};
      const playerRef = db.collection("players").doc();
      const code = makeCode();
      const playerData: Record<string, any> = {
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        code,
        signupCode: code,
        registered: false,
        coachUID: coachDoc.id,
        coachDocId: coachDoc.id,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      if (coach.org) playerData.org = coach.org;
      const batch = db.batch();
      batch.set(playerRef, playerData);
      batch.update(coachDoc.ref, {
        members: firebase.firestore.FieldValue.arrayUnion(playerRef.id),
        numberMembers: firebase.firestore.FieldValue.increment(1),
      });
      if (coach.org) batch.update(coach.org, { players: firebase.firestore.FieldValue.arrayUnion(playerRef.id) });
      await batch.commit();
      dialogRef.current?.close();
      await loadRoster();
    } catch (error: any) {
      setMessage(error.message || "The player could not be created.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function addExisting() {
    const code = codeRef.current?.value.trim().toUpperCase() ?? "";
    if (!code) return setMessage("Enter the player's code.");
    setAddBusy(true);
    setMessage("Finding player…", true);
    try {
      let query = await db.collection("players").where("code", "==", code).limit(1).get();
      if (query.empty) query = await db.collection("players").where("signupCode", "==", code).limit(1).get();
      if (query.empty) throw new Error("No player matches that code.");
      const player = query.docs[0];
      const coachDoc = coachDocRef.current;
      const coach = coachDoc.data() || {};
      if ((coach.members || []).includes(player.id)) throw new Error("That player is already on your roster.");
      const batch = db.batch();
      batch.update(coachDoc.ref, {
        members: firebase.firestore.FieldValue.arrayUnion(player.id),
        numberMembers: firebase.firestore.FieldValue.increment(1),
      });
      batch.set(
        player.ref,
        {
          coachUID: coachDoc.id,
          coachDocId: coachDoc.id,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      if (coach.org) {
        batch.update(coach.org, { players: firebase.firestore.FieldValue.arrayUnion(player.id) });
        batch.set(player.ref, { org: coach.org }, { merge: true });
      }
      await batch.commit();
      dialogRef.current?.close();
      await loadRoster();
    } catch (error: any) {
      setMessage(error.message || "The player could not be added.");
    } finally {
      setAddBusy(false);
    }
  }

  let gridContent: ReactNode;
  if (gridMode.kind === "loading") {
    gridContent = (
      <div className="portal-loading">
        <span className="spinner" />
        <p>Loading your roster…</p>
      </div>
    );
  } else if (gridMode.kind === "error") {
    gridContent = (
      <div className="error-card">
        <span className="material-symbols-outlined">error</span>
        <h3>Roster unavailable</h3>
        <p>{gridMode.message}</p>
      </div>
    );
  } else {
    const shown = filterPlayers(players, searchTerm);
    if (!shown.length) {
      gridContent = (
        <div className="empty-card">
          <span className="material-symbols-outlined">group_add</span>
          <h3>{players.length ? "No matching athletes" : "No players yet"}</h3>
          <p>{players.length ? "Try another name or player code." : "Add the first athlete to begin collecting results."}</p>
        </div>
      );
    } else {
      gridContent = shown.map(player => {
        const registered = isRegistered(player);
        return (
          <button
            key={player.id}
            className="roster-player"
            type="button"
            data-player={player.id}
            onClick={() => openPlayer(player.id)}
          >
            <span className="player-avatar">{initials(player)}</span>
            <span className="player-copy">
              <strong>{fullName(player)}</strong>
              <span className="player-meta">
                <span className={`status-chip ${registered ? "active" : "pending"}`}>
                  {registered ? "Active" : "Invite pending"}
                </span>
                {registered ? null : <span>Code {player.signupCode || player.code || "—"}</span>}
              </span>
            </span>
            <span className="player-chevron material-symbols-outlined">chevron_right</span>
          </button>
        );
      });
    }
  }

  return (
    <div className="pt-pose portal-body roster-body">
      <header className="portal-header">
        <Link className="portal-brand" to="/roster?userType=coach" aria-label="PoseTek roster">
          <span className="portal-brand-mark">P</span>
          <span>POSETEK</span>
        </Link>
        <button className="quiet-button" id="signOutButton" type="button" onClick={handleSignOut}>
          <span className="material-symbols-outlined">logout</span>
          <span>Sign Out</span>
        </button>
      </header>

      <main className="roster-shell">
        <section className="roster-heading">
          <div>
            <p className="eyebrow" id="organizationName">{orgLabel}</p>
            <h1>Roster</h1>
            <p id="rosterSummary">{rendered ? summaryText(players) : "Loading athletes…"}</p>
          </div>
          <button
            className="icon-button"
            id="refreshButton"
            type="button"
            aria-label="Refresh roster"
            onClick={() => loadRoster().catch(showError)}
          >
            <span className="material-symbols-outlined">refresh</span>
          </button>
        </section>

        <label className="search-field" id="searchWrap" hidden={!rendered || players.length <= 6}>
          <span className="material-symbols-outlined">search</span>
          <input
            id="playerSearch"
            type="search"
            placeholder="Search athletes"
            autoComplete="off"
            value={searchTerm}
            onChange={event => handleSearch(event.target.value)}
          />
        </label>

        <section className="roster-list" id="playersGrid" aria-live="polite">
          {gridContent}
        </section>

        <button className="primary-cta roster-add" id="addPlayerButton" type="button" onClick={openDialog}>
          <span className="material-symbols-outlined">person_add</span>Add Player
        </button>
      </main>

      <dialog className="portal-dialog" id="addPlayerDialog" ref={dialogRef}>
        <form method="dialog" className="dialog-card" id="dialogShell">
          <header>
            <div>
              <p className="eyebrow">Roster</p>
              <h2>Add a player</h2>
            </div>
            <button className="icon-button" value="cancel" aria-label="Close">
              <span className="material-symbols-outlined">close</span>
            </button>
          </header>
          <div className="segmented-control" role="tablist">
            <button
              type="button"
              className={addTab === "new" ? "active" : ""}
              data-add-tab="new"
              onClick={() => switchTab("new")}
            >
              New player
            </button>
            <button
              type="button"
              className={addTab === "existing" ? "active" : ""}
              data-add-tab="existing"
              onClick={() => switchTab("existing")}
            >
              Player code
            </button>
          </div>
          <section data-add-panel="new" hidden={addTab !== "new"}>
            <label>
              First name
              <input id="newFirstName" maxLength={80} autoComplete="off" ref={firstNameRef} />
            </label>
            <label>
              Last name
              <input id="newLastName" maxLength={80} autoComplete="off" ref={lastNameRef} />
            </label>
            <button
              className="primary-cta"
              id="createPlayerButton"
              type="button"
              disabled={createBusy}
              onClick={createPlayer}
            >
              Create Player
            </button>
          </section>
          <section data-add-panel="existing" hidden={addTab !== "existing"}>
            <label>
              Player code
              <input id="existingPlayerCode" maxLength={20} placeholder="PLR123" autoComplete="off" ref={codeRef} />
            </label>
            <button
              className="primary-cta"
              id="addExistingButton"
              type="button"
              disabled={addBusy}
              onClick={addExisting}
            >
              Add to Roster
            </button>
          </section>
          <p className={`form-message${formMessage.success ? " success" : ""}`} id="formMessage" aria-live="polite">
            {formMessage.text}
          </p>
        </form>
      </dialog>
    </div>
  );
}
