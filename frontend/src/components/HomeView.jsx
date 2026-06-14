export default function HomeView({ companies, onSelect }) {
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
						Pick two companies and get a structured table across competitive
						advantage, cost discipline, pricing, risks, and capital allocation
						— each cell cited or honestly marked as no evidence.
					</p>
					<div className="home-card-cta">
						Open compare <span className="home-card-arrow">→</span>
					</div>
				</button>
			</div>
		</div>
	);
}
