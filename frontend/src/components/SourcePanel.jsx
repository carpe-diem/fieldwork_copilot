import { useEffect } from "react";

export default function SourcePanel({ source, onClose }) {
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
