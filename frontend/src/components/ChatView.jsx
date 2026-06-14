import { useEffect, useRef, useState } from "react";
import CitedText from "./CitedText.jsx";

const SUGGESTED = [
  "What gives Ryanair its cost advantage, and how durable is it?",
  "How does Costco think about raising membership fees?",
  "Compare how Ryanair and Costco talk about pricing discipline.",
  "What are the biggest risks each management team worries about?",
];

export default function ChatView({ companies, onCite }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [scope, setScope] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const bottomRef = useRef(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — scroll on message/status change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  async function send(text) {
    const question = (text ?? input).trim();
    if (!question || busy) return;
    setInput("");
    setBusy(true);
    const t0 = performance.now();
    let searches = 0;

    const history = [...messages, { role: "user", content: question }];
    setMessages([...history, { role: "assistant", content: "", sources: [] }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
          company: scope || null,
        }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop();
        for (const block of events) {
          const line = block.trim();
          if (!line.startsWith("data: ")) continue;
          const evt = JSON.parse(line.slice(6));
          if (evt.type === "token") {
            setStatus("");
            setMessages((m) => {
              const copy = [...m];
              const last = { ...copy[copy.length - 1] };
              last.content += evt.text;
              copy[copy.length - 1] = last;
              return copy;
            });
          } else if (evt.type === "status") {
            searches += 1;
            setStatus(evt.text);
          } else if (evt.type === "sources") {
            const meta = {
              secs: ((performance.now() - t0) / 1000).toFixed(1),
              searches,
              count: evt.sources.length,
            };
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = {
                ...copy[copy.length - 1],
                sources: evt.sources,
                meta,
              };
              return copy;
            });
          }
        }
      }
    } catch {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "assistant",
          content:
            "The request failed. Check that the backend is running on port 8000.",
          sources: [],
        };
        return copy;
      });
    } finally {
      setStatus("");
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      <div className="scope-row">
        <label className="mono" htmlFor="scope">
          Scope
        </label>
        <select
          id="scope"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="">Whole library</option>
          {companies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            <h2>Ask the library</h2>
            <p>
              Answers are grounded in interview transcripts and cite their
              sources.
            </p>
            <div className="chips">
              {SUGGESTED.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="chip"
                  onClick={() => send(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: messages are append-only, never reordered
          <div key={i} className={`msg ${m.role}`}>
            {m.role === "assistant" ? (
              <>
                <CitedText
                  text={m.content}
                  sources={m.sources}
                  onCite={onCite}
                />
                {busy && i === messages.length - 1 && m.content && (
                  <span className="caret" />
                )}
                {m.meta && (
                  <div className="msg-meta">
                    {m.meta.secs}s · {m.meta.searches}{" "}
                    {m.meta.searches === 1 ? "search" : "searches"} ·{" "}
                    {m.meta.count} sources
                  </div>
                )}
              </>
            ) : (
              m.content
            )}
          </div>
        ))}
        {status && <div className="status">{status}…</div>}
        <div ref={bottomRef} />
      </div>

      <div className="chat-footer">
        <div className="input-row">
          <textarea
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.shiftKey)) {
                e.preventDefault();
                const ta = e.target;
                const s = ta.selectionStart;
                setInput(
                  (prev) => `${prev.slice(0, s)}\n${prev.slice(ta.selectionEnd)}`,
                );
                requestAnimationFrame(() => {
                  ta.selectionStart = ta.selectionEnd = s + 1;
                  ta.style.height = "auto";
                  ta.style.height = `${ta.scrollHeight}px`;
                });
              } else if (e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask about moats, pricing, risks…"
            disabled={busy}
          />
          <span className="kbd" title="Shift+Enter or Cmd+Enter for new line">
            ↵
          </span>
          <button
            type="button"
            onClick={() => send()}
            disabled={busy || !input.trim()}
          >
            {busy ? "Working…" : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}
