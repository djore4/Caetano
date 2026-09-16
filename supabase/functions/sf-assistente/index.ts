// Edge Function: sf-assistente
// Assistente comercial e de produto da plataforma (BMW/MINI), ancorado no parque.
// Chama o Claude (Haiku 4.5) no servidor; a ANTHROPIC_API_KEY vive como secret.
// Trabalha ao nível do PVP — nunca recebe margens/custos.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5";

const PERSONA = [
  "És o assistente comercial e de produto da plataforma Caetano Sales Force (BMW e MINI), ao serviço das equipas de vendas.",
  "Escreves em português europeu, direto, útil e sem floreados.",
  "",
  "A tua missão:",
  "1. PARTILHAR informação do parque que te é fornecido (viaturas, PVP, tipologia, concessão, estado) — com rigor.",
  "2. DISCUTIR COMERCIALMENTE as viaturas de interesse: posicionamento, argumentos de venda, comparações, adequação ao perfil do cliente.",
  "3. DISCUTIR PRODUTO: diferenças entre modelos, motorizações e tipologias (ICE/BEV/PHEV/M), pontos fortes e para quem faz sentido cada opção.",
  "4. DEBATER ideias: dá opinião fundamentada, concorda ou discorda com razão, mostra o outro lado e aponta pontos cegos.",
  "",
  "Regras:",
  "- Usa APENAS os dados do parque fornecidos como verdade de base. Se não tens um dado (preço, spec, stock), di-lo claramente — nunca inventes.",
  "- Não tens acesso a margens nem custos; raciocina sempre ao nível do PVP.",
  "- Sê conciso e substantivo. Usa **negrito** nos pontos-chave e listas curtas quando ajudarem à leitura.",
  "- Quando fizer sentido, sugere viaturas concretas do parque (modelo, versão, PVP, concessão).",
  "- Faz perguntas de volta quando faltar contexto para uma boa recomendação.",
  "- És apoio à venda, não consultor financeiro; não prometes descontos nem condições que não constam dos dados.",
].join("\n");

async function streamAnthropicText(body: Record<string, unknown>, apiKey: string): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!res.ok || !res.body) {
    const errTxt = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${errTxt.slice(0, 400)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") text += ev.delta.text;
      } catch (_) { /* linhas parciais */ }
    }
  }
  return text.trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { headers: { ...cors, "Content-Type": "application/json" }, status });
  if (req.method !== "POST") return json({ error: "Metodo nao permitido" }, 405);

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY nao configurada como secret." }, 500);

    const body = await req.json().catch(() => ({}));
    const { messages, context } = body ?? {};

    const convo = Array.isArray(messages)
      ? messages
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .map((m) => ({ role: m.role, content: m.content }))
      : [];
    if (!convo.length || convo[convo.length - 1].role !== "user") {
      return json({ error: "Pedido invalido: falta a mensagem do utilizador." }, 400);
    }

    const ctx = (typeof context === "string" && context.trim()) ? context.trim() : "Sem dados do parque nesta chamada.";
    const system = `${PERSONA}\n\n## Parque atual (fonte de verdade — apenas PVP, sem margens)\n${ctx}`;

    const resposta = await streamAnthropicText({ model: MODEL, max_tokens: 1024, system, messages: convo }, apiKey);
    return json({ resposta: resposta || "Nao consegui responder agora. Tenta reformular." });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
});
