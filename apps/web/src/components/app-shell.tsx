import type { CSSProperties, ReactNode } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { SiteHeader } from '@/components/site-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useMe } from '@/lib/authz';

/** The signed-in frame, as `dashboard-01` lays it out: inset sidebar, header, page. */
export function AppShell({ children }: { children: ReactNode }) {
  const { activeAcademyId } = useMe();
  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            {/*
              Keyed by the active academy: switching academy REMOUNTS the page. A page
              that survived the switch would keep showing what it last drew -- the
              previous academy's rows, or its refusal -- until something re-rendered it.
            */}
            <div key={activeAcademyId ?? 'none'} className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              {children}
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
