"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import styles from "./AuditForm.module.css";

/**
 * The audit input.
 *
 * A client component only because it posts and navigates; everything it renders around it (the
 * thesis, the verdict legend) stays on the server. The belt toggle defaults ON and is stated in the
 * open, because a reader who does not know a model was consulted cannot judge what they are reading
 * — and a reader who does not know it can be turned off cannot tell an infrastructure outage from a
 * finding.
 */
export function AuditForm({ sample }: { sample: string }) {
  const router = useRouter();
  const fieldId = useId();
  const [document, setDocument] = useState("");
  const [belt, setBelt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const empty = document.trim().length === 0;

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document, belt }),
      });
      const body = (await res.json()) as { id?: string; error?: string };

      if (!res.ok || !body.id) {
        // The route writes its own failure prose, so it is shown as written rather than replaced
        // with a generic message that would throw away the specific reason it gave.
        setError(body.error ?? `The audit did not complete (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      // Deliberately no `setBusy(false)`: the button stays in its working state through the
      // navigation, so there is no frame where the reader can press it a second time.
      router.push(`/report/${body.id}`);
    } catch {
      setError(
        "Could not reach the audit endpoint. That is a network or server problem, not a verdict on the document.",
      );
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="Audit a document">
      <div className={styles.fieldHead}>
        <label className={styles.fieldLabel} htmlFor={fieldId}>
          Paste a brief
        </label>
        <button
          type="button"
          className={styles.sample}
          onClick={() => {
            setDocument(sample);
            setError(null);
            field.current?.focus();
          }}
        >
          use the sample brief
        </button>
      </div>

      <textarea
        id={fieldId}
        ref={field}
        className={styles.field}
        value={document}
        onChange={(e) => {
          setDocument(e.target.value);
          if (error) setError(null);
        }}
        spellCheck={false}
        placeholder={
          "Paste the full text of a brief or memorandum. The engine reads the document's own citations and quotations — headers, page numbers, and the caption are fine to leave in."
        }
        aria-describedby={`${fieldId}-note`}
      />

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.primary}
          onClick={submit}
          disabled={busy || empty}
          data-ui="audit-submit"
        >
          {busy ? "Auditing…" : "Audit this document"}
        </button>

        <label className={styles.toggle} data-ui="belt-toggle">
          <input
            type="checkbox"
            checked={belt}
            onChange={(e) => setBelt(e.target.checked)}
            disabled={busy}
          />
          <span>
            ask the model to propose supporting spans
            <span className={styles.toggleNote}>
              {belt
                ? " every proposed span is then checked against the opinion's own text"
                : " deterministic only — no model is consulted, and the audit costs nothing"}
            </span>
          </span>
        </label>
      </div>

      <p className={styles.note} id={`${fieldId}-note`} data-ui="form-note">
        {busy ? (
          <span className={styles.working} data-ui="form-working">
            Fetching the cited opinions and checking the document against them. The corpus is cached,
            so this takes a few seconds the first time and less after that.
          </span>
        ) : empty ? (
          <>
            Nothing is stored: the audit runs in this process and the report disappears with it. A
            brief is privileged, so this build never writes one to disk.
          </>
        ) : (
          <>
            {document.length.toLocaleString("en-US")} characters. Reading every citation and every
            quotation, then checking each against the primary source.
          </>
        )}
      </p>

      {error && (
        <p className={styles.error} role="alert" data-ui="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
