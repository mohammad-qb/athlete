import { Link } from '@tanstack/react-router';
import type { ComponentProps } from 'react';
import { AcademySwitcher } from '@/components/academy-switcher';
import { NavUser } from '@/components/nav-user';
import { NAVIGATION } from '@/components/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useCan } from '@/lib/authz';

/**
 * The `dashboard-01` sidebar with real contents: the active academy (and the switcher,
 * for someone with more than one), the entries this user's permissions allow, and the
 * account menu.
 */
export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  const can = useCan();
  const { setOpenMobile } = useSidebar();
  const items = NAVIGATION.filter((item) => can(item.requires.action, item.requires.subject));

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <AcademySwitcher />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Main">
              {items.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <Link
                      to={item.to}
                      onClick={() => setOpenMobile(false)}
                      activeProps={{ 'data-active': true, 'aria-current': 'page' }}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
