import { IconCheck, IconInnerShadowTop, IconSelector } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { handleApiError } from '@/lib/api';
import { switchAcademy } from '@/lib/auth';
import { useMe } from '@/lib/authz';

/**
 * The sidebar's header: which academy the user is acting in. With one academy it is a
 * label; with more it is a menu that moves the session to another one.
 */
export function AcademySwitcher() {
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isMobile } = useSidebar();
  const [switching, setSwitching] = useState(false);

  const active = me.academies.find((academy) => academy.id === me.activeAcademyId);
  const name = active?.name ?? 'No academy';

  const label = (
    <>
      <IconInnerShadowTop className="size-5!" />
      <span className="truncate text-base font-semibold">{name}</span>
    </>
  );

  if (me.academies.length <= 1) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <div className="flex h-8 items-center gap-2 p-1.5" data-testid="active-academy">
            {label}
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  async function onSelect(academyId: string) {
    if (academyId === me.activeAcademyId || switching) return;
    setSwitching(true);
    try {
      await switchAcademy(queryClient, academyId);
      // Every loader runs again in the new academy; the landing page is re-chosen,
      // because the role (and so the menu) may differ there.
      await router.navigate({ to: '/' });
      await router.invalidate();
    } catch (error) {
      handleApiError(error);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5! data-[state=open]:bg-sidebar-accent"
              aria-label="Switch academy"
              disabled={switching}
              data-testid="active-academy"
            >
              {label}
              <IconSelector className="ms-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">Academies</DropdownMenuLabel>
            {me.academies.map((academy) => (
              <DropdownMenuItem key={academy.id} onSelect={() => void onSelect(academy.id)}>
                <span className="truncate">{academy.name}</span>
                {academy.id === me.activeAcademyId && <IconCheck className="ms-auto size-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
