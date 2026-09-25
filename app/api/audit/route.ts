import { NextResponse } from "next/server";
import { MAX_ITEMS, runAudit } from "@/lib/report/audit-run";

/**
 * The engine's only entry point from the browser.
 *
 * The response is deliberately small — an id, the summary, and one line per audited citation — and
 * the full report (opinion excerpts included) is rendered on the server by `app/report/[id]`. Two
 * reasons: the opinions are 20–60KB each and there is no reason for them to cross the wire, and the
 * API key stays in this process, where `beltConfigFromEnv` reads it from `process.env` at call time.
 *
 * `runtime = "nodejs"` is required, not a preference: the corpus layer reads cached case files with
 * `node:fs` and hashes with `node:crypto`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Guards a pathological paste. The engine's own cap (`MAX_ITEMS`) limits the audited lines. */
const MAX_DOCUMENT_CHARS = 400_000;
const MIN_DOCUMENT_CHARS = 40;

export async function POST(request: Request) {
  let document: string;
  let belt = true;

  try {
    const body = (await request.json()) as { document?: unknown; belt?: unknown };
    document = typeof body.document === "string" ? body.document : "";
    belt = body.belt !== false;
  } catch {
    return NextResponse.json({ error: "Send a JSON body with a `document` string." }, { status: 400 });
  }

  if (!document.trim()) {
    return NextResponse.json({ error: "There is no document to audit." }, { status: 400 });
  }
  if (document.length < MIN_DOCUMENT_CHARS) {
    return NextResponse.json(
      { error: `That is too short to be a brief (${document.length} characters). Paste the document text.` },
      { status: 400 },
    );
  }
  if (document.length > MAX_DOCUMENT_CHARS) {
    return NextResponse.json(
      { error: `That document is ${document.length.toLocaleString()} characters; this build audits up to ${MAX_DOCUMENT_CHARS.toLocaleString()}.` },
      { status: 413 },
    );
  }

  try {
    const { bundle, itemsFound } = await runAudit(document, { belt });
    return NextResponse.json({
      id: bundle.id,
      summary: bundle.summary,
      total: bundle.summary.total,
      itemsFound,
      cappedAt: MAX_ITEMS,
      truncated: itemsFound > bundle.summary.total,
    });
  } catch (err) {
    // The engine reports its own failures as verdicts rather than exceptions, so reaching here means
    // something unexpected — reported as a failed audit, never as a verdict.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `the audit did not complete: ${message}` }, { status: 500 });
  }
}
