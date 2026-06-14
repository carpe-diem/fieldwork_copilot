import { useEffect, useRef, useState } from "react";

const SUGGESTED = [
	"What gives Ryanair its cost advantage, and how durable is it?",
	"How does Costco think about raising membership fees?",
	"Compare how Ryanair and Costco talk about pricing discipline.",
	"What are the biggest risks each management team worries about?",
];

// ---------------------------------------------------------------- utilities

/** Render assistant text, turning [n] markers into clickable citation chips. */
function CitedText({ text, sources, onCite }) {
	const parts = text.split(/(\[\d+\])/g);
	return (
		<span>
			{parts.map((part, i) => {
				const m = part.match(/^\[(\d+)\]$/);
				// biome-ignore lint/suspicious/noArrayIndexKey: parts are positional text splits, index is stable
				if (!m) return <span key={i}>{part}</span>;
				const n = Number(m[1]);
				const source = sources?.find((s) => s.n === n);
				return (
					<button
						key={n}
						type="button"
						className="cite"
						disabled={!source}
						onClick={() => source && onCite(source)}
						title={source ? `${source.company} — ${source.title}` : ""}
					>
						{n}
					</button>
				);
			})}
		</span>
	);
}

function SourcePanel({ source, onClose }) {
	useEffect(() => {
		const onKey = (e) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	if (!source) return null;
	return (
		<aside className="source-panel">
			<div className="source-head">
				<span>Source [{source.n}]</span>
				<button
					type="button"
					className="close"
					onClick={onClose}
					aria-label="Close source (Esc)"
				>
					×
				</button>
			</div>
			<h3>{source.company}</h3>
			<p className="source-meta">
				{source.title}
				{source.date ? ` · ${source.date}` : ""}
			</p>
			<div className="source-text">{source.text}</div>
			{source.source_url && (
				<a
					className="source-link"
					href={source.source_url}
					target="_blank"
					rel="noreferrer"
				>
					Open original ↗
				</a>
			)}
		</aside>
	);
}

// ---------------------------------------------------------------- chat view

function ChatView({ companies, onCite }) {
	const [messages, setMessages] = useState([]); // {role, content, sources?}
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
	);
}

// ------------------------------------------------------------- compare view

function CompareView({ companies, onCite }) {
	const [a, setA] = useState("");
	const [b, setB] = useState("");
	const [result, setResult] = useState(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	async function run() {
		if (!a || !b || a === b) return;
		setBusy(true);
		setError("");
		setResult(null);
		try {
			const res = await fetch("/api/compare", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ company_a: a, company_b: b }),
			});
			if (!res.ok) throw new Error(await res.text());
			setResult(await res.json());
		} catch (e) {
			setError("Comparison failed. Check the backend logs.");
		} finally {
			setBusy(false);
		}
	}

	const cell = (company, dim) =>
		result?.cells.find(
			(c) =>
				c.company.toLowerCase() === company.toLowerCase() &&
				c.dimension === dim,
		);

	return (
		<div className="compare">
			<div className="compare-controls">
				<select value={a} onChange={(e) => setA(e.target.value)}>
					<option value="">Company A</option>
					{companies.map((c) => (
						<option key={c} value={c}>
							{c}
						</option>
					))}
				</select>
				<span className="mono">vs</span>
				<select value={b} onChange={(e) => setB(e.target.value)}>
					<option value="">Company B</option>
					{companies.map((c) => (
						<option key={c} value={c}>
							{c}
						</option>
					))}
				</select>
				<button
					type="button"
					onClick={run}
					disabled={busy || !a || !b || a === b}
				>
					{busy ? "Comparing…" : "Compare"}
				</button>
			</div>
			{error && <p className="error">{error}</p>}
			{result && (
				<table className="compare-table">
					<thead>
						<tr>
							<th />
							<th>{a}</th>
							<th>{b}</th>
						</tr>
					</thead>
					<tbody>
						{result.dimensions.map((dim) => (
							<tr key={dim}>
								<th className="dim">{dim}</th>
								{[a, b].map((co) => {
									const c = cell(co, dim);
									return (
										<td
											key={co}
											className={c?.confidence === "no_data" ? "nodata" : ""}
										>
											{c ? (
												<>
													{c.claim}{" "}
													{(c.citations || []).map((n) => {
														const s = result.sources.find((s) => s.n === n);
														return (
															<button
																key={n}
																type="button"
																className="cite"
																disabled={!s}
																onClick={() => s && onCite(s)}
															>
																{n}
															</button>
														);
													})}
												</>
											) : (
												"—"
											)}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}

// ------------------------------------------------------------ home view

function HomeView({ companies, onSelect }) {
	return (
		<div className="home">
			<div className="home-hero">
				<span className="home-eyebrow mono">Research intelligence</span>
				<h1 className="home-title">
					<span className="home-mark">Fieldwork</span> Copilot
				</h1>
				<p className="home-sub">
					Grounded in what management actually said. Every claim cites its
					source.
				</p>
				{companies.length > 0 && (
					<p className="home-library mono">{companies.join(" · ")}</p>
				)}
			</div>
			<div className="home-cards">
				<button
					type="button"
					className="home-card"
					onClick={() => onSelect("chat")}
				>
					<span className="mono">Chat</span>
					<h2>Ask the library</h2>
					<p>
						Ask anything about the transcripts. The agent searches, synthesizes,
						and cites every claim with a clickable source.
					</p>
					<div className="home-card-cta">
						Open chat <span className="home-card-arrow">→</span>
					</div>
				</button>
				<button
					type="button"
					className="home-card"
					onClick={() => onSelect("compare")}
				>
					<span className="mono">Compare</span>
					<h2>Compare companies</h2>
					<p>
						Pick two companies and get a structured table across moat, pricing,
						risks, and capital allocation — each cell cited or honestly marked
						as no evidence.
					</p>
					<div className="home-card-cta">
						Open compare <span className="home-card-arrow">→</span>
					</div>
				</button>
			</div>
		</div>
	);
}

// --------------------------------------------------------------------- app

const TABS = ["chat", "compare"];

function tabFromHash() {
	const h = window.location.hash.slice(1);
	return TABS.includes(h) ? h : "home";
}

export default function App() {
	const [companies, setCompanies] = useState([]);
	const [tab, setTab] = useState(tabFromHash);
	const [source, setSource] = useState(null);

	useEffect(() => {
		fetch("/api/companies")
			.then((r) => r.json())
			.then((d) => setCompanies(d.companies || []))
			.catch(() => {});
	}, []);

	// Sync hash → state on back/forward
	useEffect(() => {
		const onHash = () => setTab(tabFromHash());
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);

	function navigate(next) {
		window.location.hash = next === "home" ? "" : next;
		setTab(next);
	}

	return (
		<div className={`layout ${source ? "with-panel" : ""}`}>
			<header>
				<button
					type="button"
					className="brand brand-btn"
					onClick={() => navigate("home")}
				>
					<span className="brand-mark">Fieldwork</span> Copilot
					<span className="brand-sub mono">
						primary research, with receipts
					</span>
				</button>
				<nav>
					<button
						type="button"
						className={tab === "chat" ? "active" : ""}
						onClick={() => navigate("chat")}
					>
						Chat
					</button>
					<button
						type="button"
						className={tab === "compare" ? "active" : ""}
						onClick={() => navigate("compare")}
					>
						Compare
					</button>
				</nav>
			</header>
			<main>
				{tab === "home" && (
					<HomeView companies={companies} onSelect={navigate} />
				)}
				{tab === "chat" && (
					<ChatView companies={companies} onCite={setSource} />
				)}
				{tab === "compare" && (
					<CompareView companies={companies} onCite={setSource} />
				)}
				<SourcePanel source={source} onClose={() => setSource(null)} />
			</main>
		</div>
	);
}
