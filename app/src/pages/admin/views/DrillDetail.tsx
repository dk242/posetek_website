// One drill: every v2 field, and playback of each media slot.
//
// Media rule (catalog §6.1/§6.2): `storagePath` is the only durable address, so
// the download URL is resolved at render time and never persisted. A slot whose
// `status` is present and not "approved" is unavailable. Slots are independent —
// an approved primary demo plays whether or not the other three exist — and the
// text is readable while the video loads.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatDoseText, formatRestText } from "../../../lib/contracts/drillV2";
import type { CatalogDrill } from "../../../lib/contracts/drillV2";
import { MEDIA_SLOTS, MEDIA_SLOT_LABELS, domainLabel } from "../../../lib/contracts/types";
import type { MediaSlot } from "../../../lib/contracts/types";
import { loadDrill, mediaPlaybackUrl } from "../lib/catalog";

export default function DrillDetail() {
  const { drillId = "" } = useParams();
  const [drill, setDrill] = useState<CatalogDrill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = `${drillId} | PoseTek admin`;
    setLoading(true);
    loadDrill(drillId)
      .then(found => {
        setDrill(found);
        if (!found) setError(`${drillId} is not in the catalog.`);
      })
      .catch(loadError => setError(loadError?.message || "That drill could not be loaded."))
      .finally(() => setLoading(false));
  }, [drillId]);

  if (loading) return <div className="portal-loading"><span className="spinner" /><p>Loading {drillId}…</p></div>;
  if (!drill) return <p className="form-message" role="alert">{error}</p>;

  return (
    <>
      <section className="admin-heading">
        <Link className="icon-button" to="/admin/drills" aria-label="Back to the drill library">
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <div>
          <p className="eyebrow">{domainLabel(drill.domain)} · {drill.drillId}</p>
          <h1>{drill.name}</h1>
          <p>
            Difficulty {drill.difficultyLevel} · Ages {drill.minAge}–{drill.maxAge} ·{" "}
            {drill.requiresPartner ? "Needs a partner" : "Can be done alone"} · at most{" "}
            {drill.maxFrequencyPerWeek}× per week
          </p>
        </div>
        <div className="admin-heading-actions">
          <span className={`admin-chip ${drill.status === "published" ? "accent" : drill.status === "archived" ? "danger" : "warn"}`}>
            {drill.status}
          </span>
          {drill.needsMigration ? (
            <span className="admin-chip warn">v1 — not editable here</span>
          ) : (
            <Link className="primary-cta" to={`/admin/drills/${drill.drillId}/edit`}>
              <span className="material-symbols-outlined">edit</span>Edit drill
            </Link>
          )}
        </div>
      </section>

      {drill.needsMigration && (
        <div className="admin-banner warn">
          <span className="material-symbols-outlined">sync_problem</span>
          <p>
            This document is still catalog v1. The domain, difficulty, how-to and coach comments
            below are derived from its v1 fields for reading; nothing here writes them back.
            Editing becomes available once the v2 migration has run for this drill.
          </p>
        </div>
      )}

      <div className="admin-grid-two">
        <section className="admin-card">
          <h3>How to do it</h3>
          {drill.howTo.setup && <p><strong>Set up:</strong> {drill.howTo.setup}</p>}
          {drill.howTo.steps.length > 0 ? (
            <ol>{drill.howTo.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
          ) : (
            <p className="admin-note">No steps recorded.</p>
          )}
        </section>

        <section className="admin-card">
          <h3>Dose</h3>
          <p>{formatDoseText(drill.dose) || "No structured dose."}</p>
          <p className="admin-note">Rest: {formatRestText(drill.dose) || "not specified"}</p>
          {drill.dose.doseNote ? <p className="admin-note">{String(drill.dose.doseNote)}</p> : null}
          <p className="admin-note">
            Equipment: {drill.equipment.length ? drill.equipment.join(", ") : "none"}
          </p>
        </section>

        <section className="admin-card">
          <h3>Coach comments</h3>
          {drill.coachComments.length ? (
            <ul>{drill.coachComments.map((comment, index) => <li key={index}>{comment}</li>)}</ul>
          ) : (
            <p className="admin-note">None.</p>
          )}
        </section>

        <section className="admin-card">
          <h3>Adaptive levers</h3>
          <p className="admin-note">Not shown to athletes — for the generator, the chat and you.</p>
          {drill.adaptiveLevers.length ? (
            <ul>{drill.adaptiveLevers.map((lever, index) => <li key={index}>{lever}</li>)}</ul>
          ) : (
            <p className="admin-note">None.</p>
          )}
        </section>
      </div>

      <section className="admin-card">
        <h3>Media</h3>
        <div className="admin-media-grid">
          {MEDIA_SLOTS.map(slot => (
            <MediaSlotView key={slot} slot={slot} asset={(drill.media as any)?.[slot]} />
          ))}
        </div>
      </section>

      <section className="admin-card">
        <h3>Provenance</h3>
        <p className="admin-note">
          Catalog version {drill.catalogVersion || "—"} · how-to {drill.howToSource} · coach comments{" "}
          {drill.coachCommentsSource} · last written by {String(drill.updatedBy ?? "—")}
        </p>
      </section>
    </>
  );
}

function MediaSlotView({ slot, asset }: { slot: MediaSlot; asset: any }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");

  useEffect(() => {
    let live = true;
    if (!asset?.storagePath) {
      setState("idle");
      setUrl(null);
      return;
    }
    setState("loading");
    mediaPlaybackUrl(asset).then(resolved => {
      if (!live) return;
      setUrl(resolved);
      setState(resolved ? "ready" : "unavailable");
    });
    return () => { live = false; };
  }, [asset]);

  const isImage = String(asset?.contentType ?? "").startsWith("image/");

  return (
    <div className="admin-media-slot">
      <header>
        <h4>{MEDIA_SLOT_LABELS[slot]}</h4>
        {asset?.status && asset.status !== "approved" && (
          <span className="admin-chip warn">{String(asset.status)}</span>
        )}
      </header>
      {!asset?.storagePath && <p className="admin-note">No clip in this slot.</p>}
      {state === "loading" && <p className="admin-note">Resolving the clip…</p>}
      {state === "unavailable" && (
        <p className="admin-note">
          This clip is not playable right now — its status is “{String(asset?.status)}”, or the object
          is missing from Storage.
        </p>
      )}
      {state === "ready" && url && (
        isImage
          ? <img src={url} alt={`${MEDIA_SLOT_LABELS[slot]} still`} />
          : <video src={url} controls preload="metadata" playsInline />
      )}
      {asset?.storagePath && <p className="admin-note">{String(asset.storagePath)}</p>}
    </div>
  );
}
