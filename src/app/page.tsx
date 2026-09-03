import { CandidateWorkspace } from "@/components/candidate-workspace";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <CandidateWorkspace
      imageProvider={env.IMAGE_PROVIDER}
      animationProvider={env.ANIMATION_PROVIDER}
      maxUploadMb={env.MAX_UPLOAD_MB}
    />
  );
}
