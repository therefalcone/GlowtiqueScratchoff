import { cardUrl, getBatch, latestBatchId, listCampaignsForLinks } from "@/lib/server/cards";
import { getPool } from "@/lib/server/db";
import { qrSvg } from "@/lib/server/qr";
import { getAppUrl } from "@/lib/server/request";
import { GenerateForm } from "./GenerateForm";
import { LinksTable, type LinkRow } from "./LinksTable";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function LinksPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; batch?: string }>;
}) {
  const { campaign: campaignParam, batch: batchParam } = await searchParams;
  const pool = getPool();
  const appUrl = await getAppUrl();

  const campaigns = await listCampaignsForLinks(pool);
  const selectedId =
    campaigns.find((c) => c.id === campaignParam)?.id ?? campaigns[0]?.id ?? null;

  const batchId =
    batchParam && UUID.test(batchParam)
      ? batchParam
      : selectedId
        ? await latestBatchId(pool, selectedId)
        : null;
  const batch = batchId ? await getBatch(pool, batchId) : null;

  const rows: LinkRow[] = batch
    ? await Promise.all(
        batch.cards.map(async (c) => {
          const url = cardUrl(appUrl, c.token);
          return {
            id: c.id,
            url,
            label: c.label,
            status: c.status,
            createdAt: c.createdAt.toISOString(),
            qr: await qrSvg(url),
          };
        })
      )
    : [];

  return (
    <div className="grid grid-cols-[360px_1fr] gap-10 content-start">
      <div className="col-span-full border-b-2 border-[var(--color-divider)] pb-4">
        <h1 className="text-[32px]">Generate links</h1>
        <div className="text-muted text-[13px]">Each link is a single-scratch card. Print the QR or send the URL.</div>
      </div>

      <GenerateForm
        campaigns={campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          mode: c.mode,
          generated: c.generated,
          poolRemaining: c.poolRemaining,
          poolTotal: c.poolTotal,
          expiryPreview: c.expiryPreview?.toISOString() ?? null,
        }))}
        selectedId={selectedId}
      />

      <div className="flex flex-col gap-3 min-w-0">
        {batch ? (
          <LinksTable batchId={batch.id} batchLabel={batch.label} campaignName={batch.campaignName} rows={rows} />
        ) : (
          <div className="text-muted text-[13px] pt-2">
            {campaigns.length === 0
              ? "No live campaigns yet. Publish a campaign to start generating links."
              : "Generated links will appear here with a QR code and a copy button for each."}
          </div>
        )}
      </div>
    </div>
  );
}
