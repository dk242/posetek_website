// Port of athlete-mobile-pages.js renderAiCoach/loadConversationList/streamAiCoach.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { auth, db } from "../../../lib/firebase";
import { fullName } from "../lib/metrics";
import { CHAT_SUGGESTIONS, dateText, number, timestamp } from "../lib/mobile";
import { LockedPage, MultilineText, PageHero, PortalLoading } from "./shared";
import type { PortalContext } from "./shared";

interface StreamState {
  user: string;
  answer: string;
  failed: string | null;
}

export default function AiCoachView({ ctx }: { ctx: PortalContext }) {
  if (ctx.access === "shared") {
    return <LockedPage title="AI Coach" copy="AI Coach reads private rep history and personalized training context." />;
  }
  return <AiCoachContent ctx={ctx} />;
}

function AiCoachContent({ ctx }: { ctx: PortalContext }) {
  const [conversations, setConversations] = useState<any[] | "loading" | "error">("loading");
  // null = never attached (initial welcome); [] = attached, empty ("Start a new conversation").
  const [messages, setMessages] = useState<any[] | null>(null);
  const [stream, setStream] = useState<StreamState | null>(null);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const conversationIdRef = useRef<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const streamWipedRef = useRef(false);
  // The composer is disabled while busy; focus() must wait for the re-render
  // that removes the disabled attribute, so it runs from the effect below.
  const focusAfterBusyRef = useRef(false);
  const messagesRootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const detach = () => {
    if (unsubscribeRef.current) unsubscribeRef.current();
    unsubscribeRef.current = null;
  };

  const attach = (id: string | null) => {
    detach();
    conversationIdRef.current = id;
    if (!id || ctx.access === "preview") {
      // "New conversation" during an in-flight reply: discard the stream like
      // legacy's wholesale DOM wipe did (abort stops further deltas too).
      controllerRef.current?.abort();
      streamWipedRef.current = true;
      setStream(null);
      setMessages([]);
      return;
    }
    unsubscribeRef.current = db
      .collection("players").doc(ctx.playerId!)
      .collection("aiConversations").doc(id)
      .collection("messages").orderBy("createdAt")
      .onSnapshot(snapshot => {
        // Legacy showMessages() replaced the DOM wholesale, dropping any
        // in-flight streaming bubble; later deltas found no bubble and no-oped.
        streamWipedRef.current = true;
        setStream(null);
        setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
  };

  const loadConversations = async () => {
    try {
      let snapshot;
      const base = db.collection("players").doc(ctx.playerId!).collection("aiConversations").where("capability", "==", "pose_chat");
      try {
        snapshot = await base.orderBy("lastMessageAt", "desc").limit(20).get();
      } catch {
        snapshot = await base.limit(20).get();
      }
      const rows = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a: any, b: any) => (timestamp(b.lastMessageAt)?.valueOf() || 0) - (timestamp(a.lastMessageAt)?.valueOf() || 0));
      setConversations(rows);
    } catch (error) {
      console.error("[AI conversations]", error);
      setConversations("error");
    }
  };

  useEffect(() => {
    if (ctx.access !== "preview") void loadConversations();
    return () => {
      detach();
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Legacy scrolled the message list to the bottom on every render/delta.
  useEffect(() => {
    const root = messagesRootRef.current;
    if (root) root.scrollTop = root.scrollHeight;
  }, [messages, stream]);

  useEffect(() => {
    if (!busy && focusAfterBusyRef.current) {
      focusAfterBusyRef.current = false;
      inputRef.current?.focus();
    }
  }, [busy]);

  async function streamChat(message: string) {
    streamWipedRef.current = false;
    // Deliberate fix vs legacy: a retry replaces the previous failed bubble.
    // Legacy left the failed bubble in the DOM and streamed the new reply's
    // deltas into it (duplicate-id bug), garbling the transcript.
    setStream({ user: message, answer: "", failed: null });
    setBusy(true);
    controllerRef.current = new AbortController();
    try {
      const token = await auth.currentUser!.getIdToken();
      const response = await fetch("https://us-central1-kickai-69dd0.cloudfunctions.net/aiCoachStreamProxy", {
        method: "POST",
        signal: controllerRef.current.signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          schemaVersion: 1,
          capability: "pose_chat",
          playerId: ctx.playerId,
          message,
          clientVersion: "1.1+4",
          ...(conversationIdRef.current ? { conversationId: conversationIdRef.current } : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        let detail = `AI Coach returned ${response.status}`;
        try {
          const parsed = JSON.parse(body);
          detail = parsed.error?.message || parsed.message || detail;
        } catch { /* keep default detail */ }
        throw new Error(detail);
      }
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "", answer = "";
      const applyFrame = (frame: string) => {
        let event = "message", data = "";
        frame.split(/\r?\n/).forEach(line => {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data += line.slice(5).trim();
        });
        if (!data) return;
        const payload = JSON.parse(data);
        if (event === "start") conversationIdRef.current = payload.conversationId;
        if (event === "delta") {
          answer += payload.text || "";
          if (!streamWipedRef.current) {
            const next = answer;
            setStream(prev => (prev ? { ...prev, answer: next } : prev));
          }
        }
        if (event === "tool") setToolStatus(`${payload.status === "completed" ? "Checked" : "Checking"} ${String(payload.name || "athlete data").replace(/_/g, " ")}…`);
        if (event === "error") throw new Error(payload.message || "AI Coach could not answer.");
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || "";
        frames.forEach(applyFrame);
        if (done) break;
      }
      if (buffer.trim()) applyFrame(buffer);
      if (conversationIdRef.current) {
        attach(conversationIdRef.current);
        void loadConversations();
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const failed = error.message || "AI Coach is temporarily unavailable.";
        setStream(prev => (prev ? { ...prev, failed } : prev));
      }
    } finally {
      controllerRef.current = null;
      focusAfterBusyRef.current = true;
      setBusy(false);
      setToolStatus(null);
    }
  }

  const submitMessage = (message: string) => {
    if (!message || controllerRef.current) return;
    setDraft("");
    if (ctx.access === "preview") {
      setMessages([
        { role: "user", content: message },
        { role: "assistant", content: "In a signed-in athlete profile, AI Coach streams a response grounded in this athlete's actual reps, personal bests, and benchmark comparisons." },
      ]);
      return;
    }
    void streamChat(message);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submitMessage(draft.trim());
  };

  const suggestions = (
    <div className="chat-suggestions">
      {CHAT_SUGGESTIONS.map(item => (
        <button key={item} type="button" data-chat-suggestion={item} onClick={() => submitMessage(item)}>{item}</button>
      ))}
    </div>
  );

  const welcome = (title: string, copy: string) => (
    <div className="chat-welcome">
      <span className="material-symbols-outlined">auto_awesome</span>
      <h2>{title}</h2>
      <p>{copy}</p>
      {suggestions}
    </div>
  );

  const renderedMessages = (messages || []).map((message: any, index: number) => (
    <article key={message.id || index} className={`chat-message ${message.role === "user" ? "user" : "assistant"}`}>
      <div><MultilineText text={message.content || ""} /></div>
      {message.toolCalls?.length ? <small>Checked {message.toolCalls.map((call: any) => call.name || call).join(", ")}</small> : null}
    </article>
  ));

  let chatContent: ReactNode;
  if (stream) {
    chatContent = (
      <>
        {renderedMessages}
        <article className="chat-message user"><div>{stream.user}</div></article>
        <article className="chat-message assistant streaming" id="streamingReply">
          <div>{stream.failed !== null ? stream.failed : stream.answer ? <MultilineText text={stream.answer} /> : <span className="typing-dots">•••</span>}</div>
        </article>
      </>
    );
  } else if (messages === null) {
    chatContent = welcome("What do you want to improve?", "Ask about results, progress, D1 comparisons, or the next thing to train.");
  } else if (!messages.length) {
    chatContent = welcome("Start a new conversation", "AI Coach can inspect this athlete's current rep history.");
  } else {
    chatContent = renderedMessages;
  }

  return (
    <section className="mobile-page ai-coach-page">
      <PageHero eyebrow="Personal performance assistant" title="AI Coach" description="Knows your reps, bests, and the pro standard." icon="forum" />
      <div className="ai-coach-layout">
        <aside className="portal-card conversation-panel">
          <button
            className="primary-cta"
            id="newConversation"
            type="button"
            onClick={() => { attach(null); inputRef.current?.focus(); }}
          >
            <span className="material-symbols-outlined">add</span>New conversation
          </button>
          <h2>History</h2>
          <div id="conversationList">
            {ctx.access === "preview" ? (
              <button className="conversation-row active"><strong>Improving sprint speed</strong><small>Preview conversation</small></button>
            ) : conversations === "loading" ? (
              <PortalLoading message="Loading history…" />
            ) : conversations === "error" ? (
              <p className="conversation-empty">History is unavailable right now.</p>
            ) : conversations.length ? (
              conversations.map((item: any) => (
                <button
                  key={item.id}
                  className="conversation-row"
                  type="button"
                  data-conversation={item.id}
                  onClick={() => attach(item.id)}
                >
                  <strong>{item.title || "Conversation"}</strong>
                  <small>{dateText(item.lastMessageAt)} · {number(item.messageCount) || 0} messages</small>
                </button>
              ))
            ) : (
              <p className="conversation-empty">No conversations yet.</p>
            )}
          </div>
        </aside>
        <section className="portal-card chat-panel">
          <header>
            <div>
              <span className="chat-avatar">AI</span>
              <div><strong>PoseTek AI Coach</strong><small>{fullName(ctx.athlete)}</small></div>
            </div>
            <span className="online-dot">Ready</span>
          </header>
          <div className="chat-messages" id="chatMessages" ref={messagesRootRef}>
            {chatContent}
          </div>
          <div className="chat-tool-status" id="chatToolStatus" hidden={toolStatus === null}>{toolStatus}</div>
          <form className="chat-composer" id="chatForm" onSubmit={onSubmit}>
            <textarea
              id="chatInput"
              ref={inputRef}
              rows={1}
              maxLength={2000}
              placeholder="Ask AI Coach…"
              aria-label="Message AI Coach"
              value={draft}
              disabled={busy}
              onChange={event => setDraft(event.target.value)}
            />
            <button type="submit" aria-label="Send message"><span className="material-symbols-outlined">arrow_upward</span></button>
          </form>
        </section>
      </div>
    </section>
  );
}
