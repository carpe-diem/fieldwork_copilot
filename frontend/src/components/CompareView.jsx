import { useState } from "react";

export default function CompareView({ companies, onCite }) {
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
		} catch {
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
