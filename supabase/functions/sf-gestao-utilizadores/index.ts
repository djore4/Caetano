// Edge Function: sf-gestao-utilizadores
// Cria/atualiza um utilizador da plataforma de vendas:
//  - cria a conta Supabase Auth (se ainda não existir) com uma password temporária
//  - grava o perfil na tabela public.utilizadores
// Autorização: apenas quem tem perfil 'Administrador' pode invocar.
// Usa a service_role (lado do servidor) — nunca exposta ao browser.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function gerarPassword(): string {
  const rnd = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  return `Caetano-${rnd}-VN26`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Metodo nao permitido" });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "Sem sessao." });

    const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !caller?.user?.email) return json(401, { error: "Sessao invalida." });
    const callerEmail = caller.user.email.toLowerCase();

    // Autorizacao: so Administrador
    const { data: perfilRows } = await admin
      .from("utilizadores").select("perfil").eq("email", callerEmail).limit(1);
    if (!perfilRows?.[0] || perfilRows[0].perfil !== "Administrador") {
      return json(403, { error: "Apenas administradores podem gerir utilizadores." });
    }

    const body = await req.json().catch(() => ({}));
    const nome = (body.nome || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const perfil = body.perfil;
    const local = Array.isArray(body.local) ? body.local : [];
    if (!nome || !email || !perfil) {
      return json(400, { error: "Nome, email e perfil sao obrigatorios." });
    }

    let jaTinhaConta = false;
    let tempPassword: string | null = null;

    const pwd = gerarPassword();
    const { error: createErr } = await admin.auth.admin.createUser({
      email,
      password: pwd,
      email_confirm: true,
    });
    if (createErr) {
      const msg = (createErr.message || "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exist")) {
        jaTinhaConta = true;
      } else {
        return json(400, { error: "Erro ao criar o login: " + createErr.message });
      }
    } else {
      tempPassword = pwd;
    }

    const profile = {
      id: body.id ?? Date.now(),
      nome,
      email,
      perfil,
      local,
      negocio: Array.isArray(body.negocio) ? body.negocio : ["VN"],
      marca: Array.isArray(body.marca) ? body.marca : ["BMW"],
    };
    const { error: upErr } = await admin.from("utilizadores").upsert(profile);
    if (upErr) return json(400, { error: "Erro ao gravar o perfil: " + upErr.message });

    return json(200, { ok: true, jaTinhaConta, tempPassword });
  } catch (e) {
    return json(500, { error: String(e) });
  }
});
