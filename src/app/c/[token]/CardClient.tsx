"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CopyButton } from "@/components/CopyButton";
import { ScratchPanel } from "./ScratchPanel";

interface Base {
  displayNumber: string;
  campaignName: string;
  rulesUrl: string | null;
}

export type CardView =
  | { state: "invalid" }
  | { state: "rate_limited" }
  | ({ state: "expired"; expiredAt: string | null } & Base)
  | ({ state: "void" } & Base)
  | ({ state: "ready" | "unclaimed"; validThrough: string | null } & Base)
  | ({
      state: "revealed";
      revealedAt: string | null;
      rewardTitle: string;
      rewardDescription: string | null;
      rewardExpiresAt: string | null;
      walletUrl: string;
      walletToken?: undefined;
    } & Base);

interface RevealResponse {
  state: "revealed";
  firstReveal: boolean;
  reward: { title: string; description: string | null; terms: string | null; expiresAt: string | null };
  walletUrl: string;
  revealedAt: string;
}

const BUSINESS = "Glowtique Salon & MedSpa";
const LOCATION = "Naples, FL";

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/* ───────── layout primitives (direction 1a) ───────── */

function Frame({ right, children, overlay }: { right: string; children: ReactNode; overlay?: ReactNode }) {
  return (
    <main className="min-h-dvh bg-cream text-card-ink">
      <div className="relative mx-auto max-w-[430px] min-h-dvh flex flex-col overflow-hidden">
        {overlay}
        <header className="pt-7 px-6 flex justify-between items-center">
          <span className="font-heading font-extrabold text-[16px] tracking-[.14em]">GLOWTIQUE</span>
          <span className="text-[11px] tracking-[.08em] uppercase text-card-soft">{right}</span>
        </header>
        <div className="h-[2px] bg-card-ink mx-6 mt-4" />
        {children}
      </div>
    </main>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return <div className="text-[11px] tracking-[.12em] uppercase text-gold font-semibold">{children}</div>;
}

function Title({ children }: { children: ReactNode }) {
  return <h1 className="font-heading font-extrabold text-[30px] leading-[1.05] mt-2 tracking-[-.02em] text-pretty">{children}</h1>;
}

function PanelShell({ children }: { children: ReactNode }) {
  return <div className="mx-6 mt-6 border-2 border-card-ink p-[10px] bg-cream-panel">{children}</div>;
}

function PrimaryLink({ href, children, external }: { href: string; children: ReactNode; external?: boolean }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="block bg-card-ink text-cream px-4 py-[14px] text-[15px] font-heading font-extrabold no-underline"
    >
      {children}
    </a>
  );
}

function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="block border border-card-ink text-card-ink px-4 py-[14px] text-[15px] font-heading font-extrabold no-underline">
      {children}
    </a>
  );
}

function Footer({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <footer className="mt-auto px-6 pb-7 pt-6 flex justify-between items-center text-[12px] text-card-soft">
      <span>{left}</span>
      <span>{right}</span>
    </footer>
  );
}

function RulesLink({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a href={url} className="text-card-soft underline-offset-2" target="_blank" rel="noopener noreferrer">
      Official rules
    </a>
  );
}

/* ───────── confetti (design 04, static placement) ───────── */

const CONFETTI_SEED: Array<[number, number]> = [
  [6, 4], [18, 9], [30, 3], [44, 7], [58, 5], [72, 9], [86, 4], [94, 11], [10, 16], [26, 14],
  [50, 13], [66, 17], [80, 15], [38, 19], [90, 20], [4, 24], [22, 27], [60, 25],
];
const CONFETTI_COLORS = ["#c7992f", "#1f1a14", "#fbeab8", "#a97a25"];

function Confetti() {
  return (
    <div aria-hidden="true" className="absolute inset-0 pointer-events-none animate-[confetti-in_600ms_ease-out]">
      {CONFETTI_SEED.map(([x, y], i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: i % 3 === 0 ? 6 : 10,
            height: i % 2 ? 10 : 5,
            background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            transform: `rotate(${(i * 47) % 180}deg)`,
          }}
        />
      ))}
    </div>
  );
}

/* ───────── screens ───────── */

function RevealedPanel({ title, description, expiresAt }: { title: string; description: string | null; expiresAt: string | null }) {
  return (
    <div className="absolute inset-0 p-5 flex flex-col">
      <Kicker>You revealed</Kicker>
      <div className="font-heading font-extrabold text-[30px] leading-[1.02] tracking-[-.02em] mt-[10px] text-pretty">{title}</div>
      {description && <p className="mt-3 text-[13px] text-card-muted text-pretty">{description}</p>}
      <div className="mt-auto flex justify-between text-[12px]">
        <span className="text-card-soft">Expires</span>
        <span className="font-semibold">{fmtDate(expiresAt) ?? "No expiry"}</span>
      </div>
    </div>
  );
}

function ScratchScreen({
  token,
  card,
  bookingUrl,
  onUnclaimed,
  onDeadEnd,
}: {
  token: string;
  card: Extract<CardView, { state: "ready" | "unclaimed" }>;
  bookingUrl: string | null;
  onUnclaimed: () => void;
  onDeadEnd: (state: "expired" | "void") => void;
}) {
  const reducedMotion = useReducedMotion();
  const [reward, setReward] = useState<RevealResponse | null>(null);
  const [percent, setPercent] = useState(0);
  const [cleared, setCleared] = useState(false);
  const [forceClear, setForceClear] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestReveal = async () => {
    if (reward || requesting) return;
    if (card.state === "unclaimed") return onUnclaimed();
    setRequesting(true);
    setError(null);
    try {
      const res = await fetch(`/api/cards/${token}/reveal`, { method: "POST" });
      if (res.status === 409) return onUnclaimed();
      if (res.status === 410) {
        const body = (await res.json()) as { state: "expired" | "void" };
        return onDeadEnd(body.state);
      }
      if (res.status === 429) return setError("Too many attempts. Wait a minute and try again.");
      if (!res.ok) return setError("We couldn't reveal your card. Please try again.");
      setReward((await res.json()) as RevealResponse);
    } catch {
      setError("We couldn't reach the salon. Check your connection and try again.");
    } finally {
      setRequesting(false);
    }
  };

  const revealButton = () => {
    if (card.state === "unclaimed") return onUnclaimed();
    setForceClear(true);
    void requestReveal();
  };

  const done = cleared && reward != null;
  const validThrough = fmtDate(card.validThrough);

  return (
    <Frame right={done ? card.campaignName : LOCATION} overlay={done && !reducedMotion ? <Confetti /> : null}>
      {!done && (
        <div className="px-6 pt-6">
          <Kicker>A gift for you</Kicker>
          <Title>
            {card.campaignName}
            <br />
            Scratch Card
          </Title>
          <p className="mt-3 text-[14px] text-card-muted">
            {percent > 0 || cleared
              ? "Keep going — you're almost there."
              : "Every card holds a reward. Scratch the panel to reveal yours."}
          </p>
        </div>
      )}

      <PanelShell>
        <ScratchPanel
          displayNumber={card.displayNumber}
          forceClear={forceClear}
          reducedMotion={reducedMotion}
          disabled={card.state === "unclaimed"}
          onFirstStroke={() => void requestReveal()}
          onProgress={setPercent}
          onCleared={() => setCleared(true)}
        >
          {reward ? (
            <RevealedPanel title={reward.reward.title} description={reward.reward.description} expiresAt={reward.reward.expiresAt} />
          ) : (
            <div className="absolute inset-0 p-5 flex items-end text-[12px] text-card-soft" aria-live="polite">
              {requesting ? "Revealing…" : ""}
            </div>
          )}
        </ScratchPanel>
      </PanelShell>

      {error && (
        <div role="alert" className="mx-6 mt-4 border-l-2 border-card-ink pl-3 text-[13px] text-card-muted">
          {error}{" "}
          <button type="button" className="underline font-semibold text-card-ink" onClick={() => void requestReveal()}>
            Retry
          </button>
        </div>
      )}

      {!done && (
        <>
          {percent > 0 && !cleared ? (
            <div className="px-6 pt-5">
              <div className="flex justify-between text-[12px] text-card-soft mb-[6px]">
                <span>Revealed</span>
                <span className="text-card-ink font-semibold">{Math.round(percent * 100)}%</span>
              </div>
              <div className="h-1 bg-gold-line" role="progressbar" aria-valuenow={Math.round(percent * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Scratched">
                <div className="h-full bg-card-ink" style={{ width: `${Math.round(percent * 100)}%` }} />
              </div>
            </div>
          ) : (
            <div className="px-6 pt-5 flex flex-col gap-[6px] text-[13px] text-card-muted">
              <div className="flex justify-between">
                <span>Valid through</span>
                <span className="text-card-ink font-semibold">{validThrough ?? "No expiry"}</span>
              </div>
              <div className="flex justify-between">
                <span>One scratch per card</span>
                <span className="text-card-ink font-semibold">Guaranteed reward</span>
              </div>
            </div>
          )}
          <div className="px-6 pt-4">
            <button
              type="button"
              className="text-[13px] underline underline-offset-2 text-card-soft"
              onClick={revealButton}
              disabled={cleared}
            >
              Reveal without scratching
            </button>
          </div>
          <Footer
            left={card.rulesUrl ? <RulesLink url={card.rulesUrl} /> : BUSINESS}
            right={percent > 0 && validThrough ? `Valid through ${validThrough}` : card.rulesUrl ? BUSINESS : ""}
          />
        </>
      )}

      {done && reward && (
        <>
          <div className="mx-6 mt-4 flex items-center gap-[10px] text-[13px] font-semibold text-[#3a5a32]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Added to your rewards
          </div>
          <div className="mx-6 mt-4 border-t-2 border-card-ink border-b border-gold-rule py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] tracking-[.1em] uppercase text-card-soft">Save your rewards link</div>
              <div className="text-[13px] truncate mt-[2px]">{stripProtocol(reward.walletUrl)}</div>
            </div>
            <CopyButton
              text={reward.walletUrl}
              className="btn border border-card-ink text-card-ink px-3 py-2 flex-none gap-2"
              ariaLabel="Copy your rewards link"
            />
          </div>
          <p className="mx-6 mt-2 text-[11px] text-card-soft">Save this link — it's the only way back to your rewards.</p>
          <div className="mt-auto px-6 pb-7 pt-4 flex flex-col gap-2">
            {bookingUrl && <PrimaryLink href={bookingUrl} external>Book now</PrimaryLink>}
            <SecondaryLink href={reward.walletUrl}>View my rewards</SecondaryLink>
          </div>
        </>
      )}
    </Frame>
  );
}

function CaptureScreen({ card }: { card: Extract<CardView, { state: "ready" | "unclaimed" }> }) {
  // Phase 4 wires this form to POST /api/cards/[token]/claim.
  return (
    <Frame right={card.campaignName}>
      <div className="mx-6 mt-5 h-14 flex items-center px-4 font-heading font-extrabold text-[11px] tracking-[.14em] text-[#4a3410]" style={{ background: "linear-gradient(135deg,#a97a25,#e9c775 22%,#fbeab8 38%,#c7992f 52%,#f4dc98 68%,#b6862a 84%,#e7c672)" }}>
        YOUR CARD IS WAITING · NO. {card.displayNumber}
      </div>
      <div className="px-6 pt-6">
        <h1 className="font-heading font-extrabold text-[28px] leading-[1.08] tracking-[-.02em] text-pretty">Tell us where to keep your reward</h1>
        <p className="mt-[10px] text-[14px] text-card-muted">We'll save it to a wallet you can open anytime. Takes ten seconds.</p>
      </div>
      <div className="px-6 pt-5 text-[13px] text-card-muted">The sign-up form arrives in the next build. Your card is safe — come back with this same link.</div>
      <Footer left={card.rulesUrl ? <RulesLink url={card.rulesUrl} /> : BUSINESS} right={card.rulesUrl ? BUSINESS : ""} />
    </Frame>
  );
}

function AlreadyScratched({ card, bookingUrl }: { card: Extract<CardView, { state: "revealed" }>; bookingUrl: string | null }) {
  return (
    <Frame right={card.campaignName}>
      <div className="px-6 pt-6">
        <Kicker>Card no. {card.displayNumber}</Kicker>
        <Title>This card has already been scratched</Title>
        <p className="mt-3 text-[14px] text-card-muted">
          {card.revealedAt ? `Revealed on ${fmtDate(card.revealedAt)}. ` : ""}The reward is safe in the wallet it was saved to.
        </p>
      </div>
      <PanelShell>
        <div className="relative h-[180px] bg-cream-panel border border-gold-line p-5 flex flex-col overflow-hidden">
          <div className="absolute -right-[10px] -top-[10px] w-[120px] h-[120px]" style={{ background: "linear-gradient(135deg,#e9c775,#fbeab8 40%,#c7992f)", clipPath: "polygon(100% 0,100% 100%,0 0)" }} />
          <Kicker>Revealed</Kicker>
          <div className="font-heading font-extrabold text-[28px] leading-[1.02] tracking-[-.02em] mt-[10px] text-pretty">{card.rewardTitle}</div>
          <div className="mt-auto text-[12px] text-card-soft">Saved to wallet ending ···{card.walletUrl.slice(-4)}</div>
        </div>
      </PanelShell>
      <div className="mt-auto px-6 pb-7 pt-6 flex flex-col gap-2">
        <PrimaryLink href={card.walletUrl}>Open my rewards</PrimaryLink>
        {bookingUrl && <SecondaryLink href={bookingUrl}>Book now</SecondaryLink>}
      </div>
    </Frame>
  );
}

function DeadEnd({
  right,
  kicker,
  title,
  body,
  panel,
  bookingUrl,
  rulesUrl,
}: {
  right: string;
  kicker: string;
  title: string;
  body: string;
  panel: ReactNode;
  bookingUrl: string | null;
  rulesUrl?: string | null;
}) {
  return (
    <Frame right={right}>
      <div className="px-6 pt-6">
        <Kicker>{kicker}</Kicker>
        <Title>{title}</Title>
        <p className="mt-3 text-[14px] text-card-muted">{body}</p>
      </div>
      {panel}
      <div className="mt-auto px-6 pb-7 pt-6 flex flex-col gap-2">
        {bookingUrl && <PrimaryLink href={bookingUrl} external>Book now</PrimaryLink>}
        <div className="text-[12px] text-card-soft flex justify-between">
          <span>{rulesUrl ? <RulesLink url={rulesUrl} /> : BUSINESS}</span>
          <span>{rulesUrl ? BUSINESS : ""}</span>
        </div>
      </div>
    </Frame>
  );
}

function HatchedPanel({ label, note }: { label: string; note: string }) {
  return (
    <PanelShell>
      <div className="h-[180px] border border-gold-line p-5 flex flex-col" style={{ background: "repeating-linear-gradient(135deg,#e3d5b5 0 1px,transparent 1px 12px),#fffaf0" }}>
        <div className="text-[11px] tracking-[.12em] uppercase text-card-soft font-semibold">{label}</div>
        <div className="font-heading font-extrabold text-[22px] tracking-[.06em] uppercase text-[#a89a80] mt-[10px]">Scratch to reveal</div>
        <div className="mt-auto text-[12px] text-card-soft">{note}</div>
      </div>
    </PanelShell>
  );
}

/* ───────── root ───────── */

export function CardClient({
  token,
  card,
  appUrl,
  bookingUrl,
}: {
  token: string;
  card: CardView;
  appUrl: string;
  bookingUrl: string | null;
}) {
  const [screen, setScreen] = useState<"card" | "capture" | "expired" | "void">("card");

  if (card.state === "invalid" || card.state === "rate_limited") {
    const limited = card.state === "rate_limited";
    return (
      <DeadEnd
        right={LOCATION}
        kicker={limited ? "One moment" : "Hmm"}
        title={limited ? "Too many attempts" : "We can't find that card"}
        body={
          limited
            ? "Wait a minute and open your link again."
            : "The link may be incomplete or mistyped. Check the text or email it came from and try again."
        }
        bookingUrl={bookingUrl}
        panel={
          <div className="mx-6 mt-6 border-2 border-card-ink p-[18px] bg-cream-panel flex flex-col gap-[10px]">
            <div className="text-[11px] tracking-[.1em] uppercase text-card-soft">Link you opened</div>
            <div className="text-[13px] font-semibold break-all">{stripProtocol(`${appUrl}/c/${token}`)}</div>
          </div>
        }
      />
    );
  }

  if (card.state === "expired" || screen === "expired") {
    const expiredAt = card.state === "expired" ? fmtDate(card.expiredAt) : null;
    return (
      <DeadEnd
        right={card.campaignName}
        kicker={`Card no. ${card.displayNumber}`}
        title={expiredAt ? `This card expired on ${expiredAt}` : "This card has expired"}
        body={`${card.campaignName} has ended, but there's always something new on our menu.`}
        bookingUrl={bookingUrl}
        rulesUrl={card.rulesUrl}
        panel={<HatchedPanel label="Expired" note="Unscratched · No longer redeemable" />}
      />
    );
  }

  if (card.state === "void" || screen === "void") {
    return (
      <DeadEnd
        right={card.campaignName}
        kicker={`Card no. ${card.displayNumber}`}
        title="This card is no longer valid"
        body="It was cancelled by the salon before it was scratched. Ask the front desk if you think that's a mistake."
        bookingUrl={bookingUrl}
        rulesUrl={card.rulesUrl}
        panel={<HatchedPanel label="Cancelled" note="Unscratched · Not redeemable" />}
      />
    );
  }

  if (card.state === "revealed") return <AlreadyScratched card={card} bookingUrl={bookingUrl} />;

  if (screen === "capture") return <CaptureScreen card={card} />;

  return (
    <ScratchScreen
      token={token}
      card={card}
      bookingUrl={bookingUrl}
      onUnclaimed={() => setScreen("capture")}
      onDeadEnd={setScreen}
    />
  );
}
