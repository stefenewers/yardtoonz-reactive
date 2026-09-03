import { StoryboardStrip } from "@/components/storyboard-strip";

export const dynamic = "force-dynamic";

export default async function StoryboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StoryboardStrip candidateId={id} />;
}
