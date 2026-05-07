import type { Metadata } from "next";
import MarketPurchaseCard from "@/components/discover/MarketPurchaseCard";
import BackToDiscoverLink from "@/components/discover/BackToDiscoverLink";
import ListingNotFound from "@/components/discover/ListingNotFound";
import ListingDetailHeader from "@/components/discover/ListingDetailHeader";
import ListingDetailMetaGrid from "@/components/discover/ListingDetailMetaGrid";
import ListingDetailTags from "@/components/discover/ListingDetailTags";
import ListingPolicySignals from "@/components/discover/ListingPolicySignals";
import ListingExampleResponse from "@/components/discover/ListingExampleResponse";
import { fetchListing } from "@/lib/listing-detail-api";
import { formatUsdcLabel } from "@/lib/format";

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const listing = await fetchListing(id);
  return {
    title: listing?.metadata?.name
      ? `${listing.metadata.name} — ChainLens`
      : `Listing #${id} — ChainLens`,
  };
}

export default async function DiscoverDetailPage({ params }: PageProps) {
  const { id } = await params;
  const listing = await fetchListing(id);

  if (!listing) return <ListingNotFound />;

  const meta = listing.metadata;
  const price = formatUsdcLabel(meta?.pricing?.amount);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <BackToDiscoverLink />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="card p-6">
          <ListingDetailHeader listing={listing} price={price} />
          <ListingDetailMetaGrid meta={meta} stats={listing.stats} />
          <ListingDetailTags tags={meta?.tags ?? []} />
          <ListingPolicySignals recentErrors={listing.recentErrors} />

          {/* AI Analyst (Trust + Market) is now a paid seller-side SaaS at
              /seller. Discover keeps only deterministic signals so buyers
              always see the same view regardless of LLM availability. */}

          <ListingExampleResponse example={meta?.example_response} />
        </section>

        <MarketPurchaseCard listing={listing} />
      </div>
    </div>
  );
}
