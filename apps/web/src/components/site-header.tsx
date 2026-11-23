import { useMatches } from '@tanstack/react-router';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

/** The `dashboard-01` header: the sidebar toggle and the title of the current page. */
export function SiteHeader() {
  // The deepest matched route that names itself (`staticData.title`) titles the page.
  const title = useMatches({
    select: (matches) => matches.map((match) => match.staticData.title).filter(Boolean).at(-1),
  });

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ms-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <h1 className="text-base font-medium">{title}</h1>
      </div>
    </header>
  );
}
