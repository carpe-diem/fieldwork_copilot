import { useEffect, useState } from "react";
import ChatView from "./components/ChatView.jsx";
import CompareView from "./components/CompareView.jsx";
import HomeView from "./components/HomeView.jsx";
import SourcePanel from "./components/SourcePanel.jsx";

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
