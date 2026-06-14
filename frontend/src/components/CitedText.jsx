function renderInline(text, sources, onCite) {
	const parts = text.split(/(\[\d+\]|\*\*[^*\n]+\*\*)/g);
	return parts.map((part, i) => {
		const citeMatch = part.match(/^\[(\d+)\]$/);
		if (citeMatch) {
			const n = Number(citeMatch[1]);
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
		}
		if (part.startsWith("**") && part.endsWith("**")) {
			// biome-ignore lint/suspicious/noArrayIndexKey: positional split, stable
			return <strong key={i}>{part.slice(2, -2)}</strong>;
		}
		// biome-ignore lint/suspicious/noArrayIndexKey: positional split, stable
		return <span key={i}>{part}</span>;
	});
}

export default function CitedText({ text, sources, onCite }) {
	const paragraphs = text.split(/\n\n+/);
	return (
		<div className="cited-text">
			{paragraphs.map((para, i) => {
				if (/^\d+\. /.test(para)) {
					const items = para
						.split(/\n(?=\d+\. )/)
						.map((item) => item.replace(/^\d+\. /, ""));
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: paragraph order is stable
						<ol key={i}>
							{items.map((item, j) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: item order is stable
								<li key={j}>{renderInline(item, sources, onCite)}</li>
							))}
						</ol>
					);
				}
				if (/^[-•] /.test(para)) {
					const items = para
						.split(/\n(?=[-•] )/)
						.map((item) => item.replace(/^[-•] /, ""));
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: paragraph order is stable
						<ul key={i}>
							{items.map((item, j) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: item order is stable
								<li key={j}>{renderInline(item, sources, onCite)}</li>
							))}
						</ul>
					);
				}
				// biome-ignore lint/suspicious/noArrayIndexKey: paragraph order is stable
				return <p key={i}>{renderInline(para, sources, onCite)}</p>;
			})}
		</div>
	);
}
