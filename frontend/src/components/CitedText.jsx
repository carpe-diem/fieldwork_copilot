export default function CitedText({ text, sources, onCite }) {
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
