// Edge Function: sf-assistente
// Assistente comercial e de produto da plataforma (BMW/MINI), ancorado no parque.
// Chama o Claude (Haiku 4.5) no servidor; a ANTHROPIC_API_KEY vive como secret.
// Trabalha ao nível do PVP — nunca recebe margens/custos.
// Tem acesso à internet via a ferramenta server-side `web_search` da Anthropic,
// para recolher informação de produto e de concorrência (modelos rivais, specs,
// preços indicativos de mercado). A pesquisa corre na infraestrutura da Anthropic.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5";
// Ferramenta de pesquisa web server-side. Variante básica (compatível com Haiku 4.5).
// max_uses limita o nº de pesquisas por resposta (custo/latência controlados).
const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 5 };

const PERSONA = [
  "És o assistente comercial e de produto da plataforma Caetano Sales Force (BMW e MINI), ao serviço das equipas de vendas.",
  "Escreves em português europeu, direto, útil e sem floreados.",
  "",
  "A tua missão:",
  "1. PARTILHAR informação do parque que te é fornecido (viaturas, PVP, tipologia, concessão, estado) — com rigor.",
  "2. DISCUTIR COMERCIALMENTE as viaturas de interesse: posicionamento, argumentos de venda, comparações, adequação ao perfil do cliente.",
  "3. DISCUTIR PRODUTO: diferenças entre modelos, motorizações e tipologias (ICE/BEV/PHEV/M), pontos fortes e para quem faz sentido cada opção.",
  "4. DEBATER ideias: dá opinião fundamentada, concorda ou discorda com razão, mostra o outro lado e aponta pontos cegos.",
  "5. PESQUISAR NA INTERNET quando ajudar: podes usar a ferramenta `web_search` para obter informação de PRODUTO e de CONCORRÊNCIA (modelos rivais — ex. Mercedes, Audi, Tesla, Volvo —, especificações, autonomias, preços indicativos de mercado, novidades). Faz pesquisas objetivas e cita a origem quando o dado for relevante.",
  "",
  "Regras:",
  "- O parque fornecido é a ÚNICA verdade sobre o nosso stock e o nosso PVP. Nunca inventes preços, specs ou stock nosso — se não tens o dado, di-lo.",
  "- Informação vinda da web é EXTERNA e indicativa: identifica-a como tal, não a confundas com o PVP do parque e não trates preços de concorrência como valores oficiais. Se a pesquisa não devolver um dado, diz que não confirmaste — não preenchas com suposições.",
  "- Não tens acesso a margens nem custos; raciocina sempre ao nível do PVP.",
  "- Sê conciso e substantivo. Usa **negrito** nos pontos-chave e listas curtas quando ajudarem à leitura.",
  "- Quando fizer sentido, sugere viaturas concretas do parque (modelo, versão, PVP, concessão).",
  "- Faz perguntas de volta quando faltar contexto para uma boa recomendação.",
  "- És apoio à venda, não consultor financeiro; não prometes descontos nem condições que não constam dos dados.",
].join("\n");

type Bloco = { type?: string; text?: string; [k: string]: unknown };

// Faz o pedido ao Claude (não-streaming) com a ferramenta de pesquisa web e
// resolve a eventual pausa `pause_turn` (o servidor pausa em turnos longos com
// várias pesquisas; reenviamos o conteúdo do assistente para continuar).
async function responderComPesquisa(
  system: string,
  convo: Array<{ role: string; content: unknown }>,
  apiKey: string,
): Promise<string> {
  const messages = [...convo];
  let texto = "";

  for (let i = 0; i < 6; i++) {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages, tools: [WEB_SEARCH_TOOL] }),
    });
    if (!res.ok) {
      const errTxt = await res.text().catch(() => "");
      throw new Error(`Anthropic ${res.status}: ${errTxt.slice(0, 400)}`);
    }
    const data = await res.json();
    const content: Bloco[] = Array.isArray(data?.content) ? data.content : [];
    for (const b of content) {
      if (b?.type === "text" && typeof b.text === "string") texto += b.text;
    }
    // Turno longo pausado pelo servidor: devolve o conteúdo tal-e-qual e continua.
    if (data?.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content });
      continue;
    }
    break;
  }
  return texto.trim();
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

    const resposta = await responderComPesquisa(system, convo, apiKey);
    return json({ resposta: resposta || "Nao consegui responder agora. Tenta reformular." });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
});
