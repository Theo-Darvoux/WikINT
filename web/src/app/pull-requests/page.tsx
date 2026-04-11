import { PRList } from "@/components/pr/pr-list";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";

export default function PullRequestsPage() {
  return (
    <div className="w-full container mx-auto max-w-4xl px-4 py-6 pb-20 md:pb-6">
      <Suspense
        fallback={
          <div className="flex justify-center p-12">
            <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
          </div>
        }
      >
        <PRList />
      </Suspense>
    </div>
  );
}
