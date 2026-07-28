"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [bridge, setBridge] = useState("checking...");

  useEffect(() => {
    setBridge((window as any).zero ? "available" : "not enabled");
  }, []);

  return (
    <main>
      <p className="eyebrow">Native SDK + Next.js</p>
      <h1>Native Shell</h1>
      <p className="lede">A Next.js frontend running inside the system WebView.</p>
      <div className="card">
        <span>Native bridge</span>
        <strong>{bridge}</strong>
      </div>
    </main>
  );
}
