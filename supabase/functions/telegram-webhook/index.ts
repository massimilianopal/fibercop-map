import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sendTelegramMessage(chatId: number, text: string) {
  if (!TELEGRAM_BOT_TOKEN) return;

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });
}

async function saveSubscription(chatId: number, pointId: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase environment variables");
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      chat_id: chatId,
      point_id: pointId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase insert failed: ${response.status} ${errorText}`);
  }
}

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return jsonResponse({ ok: true, message: "telegram webhook alive" });
    }

    const update = await req.json();
    const message = update?.message;
    const chatId = message?.chat?.id;
    const text: string | undefined = message?.text;

    if (!chatId || !text) {
      return jsonResponse({ ok: true, ignored: "non-text update" });
    }

    if (!text.startsWith("/start")) {
      return jsonResponse({ ok: true, ignored: "not a /start command" });
    }

    const parts = text.trim().split(/\s+/);
    const pointId = parts[1]?.trim();

    if (!pointId) {
      await sendTelegramMessage(
        chatId,
        "Apri la mappa e usa il pulsante Telegram del punto che vuoi seguire.",
      );
      return jsonResponse({ ok: true, message: "missing point id" });
    }

    await saveSubscription(chatId, pointId);

    await sendTelegramMessage(
      chatId,
      `🔔 Ti avviserò quando il punto ${pointId} cambierà stato.`,
    );

    return jsonResponse({ ok: true, subscribed: pointId });
  } catch (error) {
    console.error(error);
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});