import { Nav } from "@/components/nav";
import { Skeleton } from "@/components/ui/skeleton";

export default function PolicyDetailLoading() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <Skeleton className="h-4 w-28 mb-4" />

          <div className="flex items-start justify-between mb-6">
            <div>
              <Skeleton className="h-7 w-48 mb-2" />
              <div className="flex gap-1.5">
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            </div>
            <div className="hidden md:flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-5 w-32 mb-1" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-4 py-3 mb-6">
            <Skeleton className="h-3 w-16 mb-2" />
            <Skeleton className="h-4 w-full mb-1.5" />
            <Skeleton className="h-4 w-3/4" />
          </div>

          <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden mb-6">
            <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
              <Skeleton className="h-4 w-28" />
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="bg-foreground/[0.02]">
                  <th className="px-4 py-2.5"><Skeleton className="h-3 w-16" /></th>
                  <th className="px-4 py-2.5 text-right"><Skeleton className="h-3 w-10 ml-auto" /></th>
                  <th className="hidden sm:table-cell px-4 py-2.5 text-right"><Skeleton className="h-3 w-16 ml-auto" /></th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3].map((i) => (
                  <tr key={i} className="border-t border-foreground/4">
                    <td className="px-4 py-2.5"><Skeleton className="h-4 w-36" /></td>
                    <td className="px-4 py-2.5 text-right"><Skeleton className="h-4 w-20 ml-auto" /></td>
                    <td className="hidden sm:table-cell px-4 py-2.5 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
