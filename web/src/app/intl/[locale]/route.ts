import { NextRequest, NextResponse } from "next/server";

// Static per-locale imports so Turbopack can resolve the module graph at build time.
import enMessages from "../../../../messages/en.json";
import frMessages from "../../../../messages/fr.json";

const MESSAGES: Record<string, unknown> = {
  en: enMessages,
  fr: frMessages,
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;

  const messages = MESSAGES[locale];
  if (!messages) {
    return NextResponse.json({ error: "Unsupported locale" }, { status: 400 });
  }

  return NextResponse.json(messages, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
