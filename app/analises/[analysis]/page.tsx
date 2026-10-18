import { notFound } from "next/navigation";
import { analysisKindSchema } from "@/lib/analytics/contracts";
import { AnalysisPage } from "@/components/analytics/analysis-page";

export default async function Page({ params, searchParams }: { params: Promise<{ analysis: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parsed = analysisKindSchema.safeParse((await params).analysis);
  if (!parsed.success) notFound();
  return <AnalysisPage kind={parsed.data} searchParams={searchParams} />;
}
