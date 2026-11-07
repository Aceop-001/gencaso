"use client";

import { useRef, useState } from "react";
import { parseCefiCsv, TEMPLATE_CSV } from "@/lib/cefi/csv";
import type { CefiUpload } from "@/lib/cefi/dataset";
import { PLANNED_EXCHANGES } from "@/lib/cefi/exchanges";
import type { CountryCode } from "@/lib/tax";
import { CountrySelect } from "./CountrySelect";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** CeFi mode: upload exchange exports (Gencaso CSV template). Files are read in the browser. */
export function CefiPanel({ country, onCountry, onSubmit }: { country: CountryCode; onCountry: (c: CountryCode) => void; onSubmit: (uploads: CefiUpload[]) => void }) {
  const [uploads, setUploads] = useState<CefiUpload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | File[]) => {
    setError(null);
    const next: CefiUpload[] = [];
    for (const f of Array.from(files)) {
      if (!/\.csv$/i.test(f.name)) {
        setError(`${f.name}: only .csv files are supported.`);
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        setError(`${f.name}: files up to 10 MB.`);
        continue;
      }
      const parsed = parseCefiCsv(await f.text(), f.name);
      next.push({ fileName: f.name, ...parsed });
    }
    setUploads((u) => [...u.filter((x) => !next.some((n) => n.fileName === x.fileName)), ...next]);
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "gencaso-cefi-template.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const usable = uploads.reduce((n, u) => n + u.events.length, 0);

  return (
    <div className="w-full text-left">
      <div className="glass rounded-[28px] p-2">
        <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void addFiles(e.dataTransfer.files);
            }}
            className={`flex min-h-16 flex-1 items-center gap-3 rounded-[22px] border border-dashed px-5 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 ${dragging ? "border-cyan bg-cyan/10" : "border-line-strong bg-bg/60 hover:bg-bg/80"}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-cyan">
              <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
            </svg>
            <span>
              <span className="block text-[15px] text-ink">Drop your exchange CSV here, or click to choose</span>
              <span className="block text-xs text-ink-3">Gencaso template · several files OK · read in your browser</span>
            </span>
          </button>
          <input ref={input} type="file" accept=".csv,text/csv" multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files)} />
          <div className="md:w-[220px]">
            <CountrySelect value={country} onChange={onCountry} />
          </div>
          <button
            type="button"
            disabled={!usable}
            onClick={() => onSubmit(uploads)}
            className="h-16 rounded-[22px] px-8 font-medium text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/70 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "linear-gradient(135deg, #2f6bff 0%, #1fb6ff 60%, #38e1ff 100%)" }}
          >
            Calculate →
          </button>
        </div>

        {uploads.length > 0 && (
          <ul className="mt-2 space-y-1 px-3 pb-2 text-sm">
            {uploads.map((u) => (
              <li key={u.fileName} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-ink">{u.fileName}</span>
                <span className="text-ink-3">{u.events.length} of {u.rows} rows read</span>
                {u.exchanges.length > 0 && <span className="text-ink-3">· {u.exchanges.join(", ")}</span>}
                {u.issues.length > 0 && <span className="text-warn" title={u.issues.map((i) => `line ${i.line}: ${i.message}`).join("\n")}>· {u.issues.length} skipped (first: line {u.issues[0].line}: {u.issues[0].message})</span>}
                <button type="button" onClick={() => setUploads((x) => x.filter((y) => y.fileName !== u.fileName))} className="text-ink-3 hover:text-white" aria-label={`Remove ${u.fileName}`}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex min-h-6 flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[13px] text-ink-3" aria-live="polite">
        {error ? (
          <span role="alert" className="text-bad">{error}</span>
        ) : (
          <>
            <span>Your trades stay on your device. Only dates are sent, to fetch exchange rates.</span>
            <button type="button" onClick={downloadTemplate} className="rounded-full border border-line px-3 py-1 text-ink-2 transition hover:border-line-strong hover:text-ink">
              Download the CSV template
            </button>
          </>
        )}
      </div>

      <div className="mt-8 text-center">
        <div className="text-[11px] uppercase tracking-[0.2em] text-ink-3">Auto-import coming soon</div>
        <div className="mx-auto mt-3 flex max-w-3xl flex-wrap justify-center gap-2 text-xs">
          {PLANNED_EXCHANGES.map((x) => (
            <span key={x} className="rounded-full border border-line bg-bg/40 px-3 py-1 text-ink-2 backdrop-blur">{x}</span>
          ))}
        </div>
        <p className="mx-auto mt-3 max-w-xl text-xs leading-relaxed text-ink-3">
          Until then, copy rows from any exchange&apos;s futures P&amp;L or transaction history into the template: date, exchange, market, type (realized_pnl, funding, fee, deposit, withdrawal) and amount in USD.
        </p>
      </div>
    </div>
  );
}
