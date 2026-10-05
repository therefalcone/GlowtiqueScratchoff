import type { Metadata } from "next";
import { loadPublicCard } from "@/lib/server/cards";
import { getPool } from "@/lib/server/db";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { getAppUrl, getClientIp } from "@/lib/server/request";
import { CardClient, type CardView } from "./CardClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your Glowtique card",
  robots: { index: false, follow: false },
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export default async function CardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pool = getPool();

  const limit = await checkRateLimit(pool, {
    key: `card:${await getClientIp()}`,
    limit: 60,
    windowSeconds: 60,
  });
  const appUrl = await getAppUrl();
  const bookingUrl = process.env.NEXT_PUBLIC_BOOKING_URL || null;

  if (!limit.allowed) {
    return <CardClient token={token} card={{ state: "rate_limited" }} appUrl={appUrl} bookingUrl={bookingUrl} />;
  }

  const card = await loadPublicCard(pool, token);
  let view: CardView;
  switch (card.state) {
    case "invalid":
      view = { state: "invalid" };
      break;
    case "expired":
      view = { ...card, expiredAt: iso(card.expiredAt) };
      break;
    case "void":
      view = card;
      break;
    case "ready":
    case "unclaimed":
      view = { ...card, validThrough: iso(card.validThrough) };
      break;
    case "revealed":
      view = {
        ...card,
        revealedAt: iso(card.revealedAt),
        rewardExpiresAt: iso(card.rewardExpiresAt),
        walletUrl: `${appUrl}/w/${card.walletToken}`,
        walletToken: undefined,
      };
      break;
  }

  return <CardClient token={token} card={view} appUrl={appUrl} bookingUrl={bookingUrl} />;
}
