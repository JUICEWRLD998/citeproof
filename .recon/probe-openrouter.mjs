// Verify the exact OpenRouter slug + capabilities for Gemini 2.5 Flash.
// Public models endpoint: no credential required.
const log = [];
const r = await fetch("https://openrouter.ai/api/v1/models", { headers: { Accept: "application/json" } });
log.push("models endpoint: HTTP " + r.status);
const j = await r.json();
log.push("total models: " + (j.data || []).length);

const hits = (j.data || []).filter(m => /gemini-2\.5-flash/i.test(m.id));
log.push("\n=== matches for gemini-2.5-flash ===");
for (const m of hits) {
  log.push(`\nslug: ${m.id}`);
  log.push(`  name: ${m.name}`);
  log.push(`  context: ${m.context_length}  max_out: ${m.top_provider?.max_completion_tokens}`);
  log.push(`  prompt $/tok: ${m.pricing?.prompt}   completion $/tok: ${m.pricing?.completion}`);
  log.push(`  modalities in/out: ${JSON.stringify(m.architecture?.input_modalities)} / ${JSON.stringify(m.architecture?.output_modalities)}`);
  const sp = m.supported_parameters || [];
  log.push(`  structured_outputs: ${sp.includes("structured_outputs")}`);
  log.push(`  response_format: ${sp.includes("response_format")}`);
  log.push(`  tools: ${sp.includes("tools")}   seed: ${sp.includes("seed")}   temperature: ${sp.includes("temperature")}`);
  log.push(`  all params: ${sp.join(", ")}`);
}

// Price a realistic audit: 40k input tokens per citation, 400 output.
const m = hits.find(x => x.id === "google/gemini-2.5-flash");
if (m) {
  const inCost = 40000 * Number(m.pricing.prompt);
  const outCost = 400 * Number(m.pricing.completion);
  log.push(`\n=== cost model: 40k in / 400 out per citation ===`);
  log.push(`  per citation: $${inCost.toFixed(6)}  (in $${inCost.toFixed(6)} + out $${outCost.toFixed(6)})`);
  log.push(`  20-citation brief: $${((inCost + outCost) * 20).toFixed(5)}`);
}
console.log(log.join("\n"));
