import { notFound } from "next/navigation";
import { getCampaign } from "@/lib/server/campaigns";
import { getPool } from "@/lib/server/db";
import { CampaignBuilder, type BuilderCampaign } from "../CampaignBuilder";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const campaign = await getCampaign(getPool(), id);
  if (!campaign) notFound();

  const data: BuilderCampaign = {
    id: campaign.id,
    name: campaign.name,
    mode: campaign.mode,
    status: campaign.status,
    startsAt: campaign.startsAt?.toISOString().slice(0, 10) ?? null,
    endsAt: campaign.endsAt?.toISOString().slice(0, 10) ?? null,
    cardExpiryDays: campaign.cardExpiryDays,
    rewardExpiryDays: campaign.rewardExpiryDays,
    officialRulesUrl: campaign.officialRulesUrl,
    locked: campaign.rewardsLockedAt != null,
    generatedCount: campaign.generatedCount,
    rewards: campaign.rewards.map((r) => ({
      title: r.title,
      description: r.description,
      terms: r.terms,
      retailValueCents: r.retailValueCents,
      weight: r.weight,
      quantityTotal: r.quantityTotal,
      quantityRemaining: r.quantityRemaining,
    })),
  };
  return <CampaignBuilder campaign={data} />;
}
